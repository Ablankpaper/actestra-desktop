//! Linux-only transport composition for the Goose runner.
//!
//! The module is compiled for Unix test builds as well so its bounded transport
//! contracts can be exercised on the development host. Production entry points
//! are called only from the Linux runner path.

#[cfg(unix)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
mod implementation {
    use std::io;
    use std::net::{Ipv4Addr, SocketAddr, TcpListener};
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::time::Duration;

    use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
    use tokio::net::{TcpListener as TokioTcpListener, TcpStream, UnixStream};
    use tokio::sync::{oneshot, Semaphore};
    use tokio::task::{JoinHandle, JoinSet};
    use tokio::time::timeout;

    pub(crate) const CAPABILITY_SOCKET_ENVIRONMENT_KEY: &str =
        "ACTESTRA_GOOSE_LINUX_CAPABILITY_SOCKET";
    pub(crate) const MODEL_SOCKET_ENVIRONMENT_KEY: &str = "ACTESTRA_GOOSE_LINUX_MODEL_SOCKET";
    pub(crate) const CAPABILITY_PORT_ENVIRONMENT_KEY: &str = "ACTESTRA_GOOSE_LINUX_CAPABILITY_PORT";
    pub(crate) const MODEL_PORT_ENVIRONMENT_KEY: &str = "ACTESTRA_GOOSE_LINUX_MODEL_PORT";
    pub(crate) const WORKSPACE_ROOT_ENVIRONMENT_KEY: &str = "ACTESTRA_GOOSE_LINUX_WORKSPACE_ROOT";
    pub(crate) const LINUX_RUNTIME_ENVIRONMENT_KEYS: [&str; 5] = [
        CAPABILITY_SOCKET_ENVIRONMENT_KEY,
        MODEL_SOCKET_ENVIRONMENT_KEY,
        CAPABILITY_PORT_ENVIRONMENT_KEY,
        MODEL_PORT_ENVIRONMENT_KEY,
        WORKSPACE_ROOT_ENVIRONMENT_KEY,
    ];

    pub(crate) const MAX_RELAY_CONNECTIONS: usize = 8;
    pub(crate) const MAX_RELAY_BYTES: usize = 256 * 1024;
    const MAX_UNIX_SOCKET_PATH_BYTES: usize = 103;
    const MAX_WORKSPACE_PATH_BYTES: usize = 4 * 1024;
    const RELAY_BUFFER_BYTES: usize = 8 * 1024;
    const RELAY_TIMEOUT: Duration = Duration::from_secs(30);

    #[derive(Clone, Debug, PartialEq, Eq)]
    pub(crate) struct LinuxBridgeEnvironment {
        pub(crate) capability_socket: PathBuf,
        pub(crate) model_socket: PathBuf,
        pub(crate) capability_port: u16,
        pub(crate) model_port: u16,
        pub(crate) workspace_root: PathBuf,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(crate) enum LinuxRuntimeConfigError {
        Missing,
        Invalid,
    }

    impl LinuxBridgeEnvironment {
        pub(crate) fn from_environment() -> Result<Self, LinuxRuntimeConfigError> {
            parse_linux_environment_with(|key| std::env::var(key).ok())
        }

        pub(crate) fn private_root(&self) -> Result<PathBuf, LinuxRuntimeConfigError> {
            let bridge = self
                .capability_socket
                .parent()
                .ok_or(LinuxRuntimeConfigError::Invalid)?;
            bridge
                .parent()
                .filter(|root| root.parent().is_some())
                .map(Path::to_path_buf)
                .ok_or(LinuxRuntimeConfigError::Invalid)
        }
    }

    pub(crate) fn parse_linux_environment_with<F>(
        mut read_environment: F,
    ) -> Result<LinuxBridgeEnvironment, LinuxRuntimeConfigError>
    where
        F: FnMut(&str) -> Option<String>,
    {
        let capability_socket = read_environment(CAPABILITY_SOCKET_ENVIRONMENT_KEY)
            .ok_or(LinuxRuntimeConfigError::Missing)
            .and_then(|value| validate_socket_path(value.as_ref()))?;
        let model_socket = read_environment(MODEL_SOCKET_ENVIRONMENT_KEY)
            .ok_or(LinuxRuntimeConfigError::Missing)
            .and_then(|value| validate_socket_path(value.as_ref()))?;
        let capability_port = read_environment(CAPABILITY_PORT_ENVIRONMENT_KEY)
            .ok_or(LinuxRuntimeConfigError::Missing)
            .and_then(|value| parse_port(&value))?;
        let model_port = read_environment(MODEL_PORT_ENVIRONMENT_KEY)
            .ok_or(LinuxRuntimeConfigError::Missing)
            .and_then(|value| parse_port(&value))?;
        let workspace_root = read_environment(WORKSPACE_ROOT_ENVIRONMENT_KEY)
            .ok_or(LinuxRuntimeConfigError::Missing)
            .and_then(|value| validate_directory_path(value.as_ref()))?;

        if capability_socket == model_socket
            || capability_port == model_port
            || capability_socket.parent() != model_socket.parent()
        {
            return Err(LinuxRuntimeConfigError::Invalid);
        }

        Ok(LinuxBridgeEnvironment {
            capability_socket,
            model_socket,
            capability_port,
            model_port,
            workspace_root,
        })
    }

    fn validate_socket_path(value: &str) -> Result<PathBuf, LinuxRuntimeConfigError> {
        let path = Path::new(value);
        if !is_bounded_absolute_path(path, MAX_UNIX_SOCKET_PATH_BYTES)
            || path.parent().is_none()
            || path.parent() == Some(Path::new("/"))
        {
            return Err(LinuxRuntimeConfigError::Invalid);
        }
        Ok(path.to_path_buf())
    }

    fn validate_directory_path(value: &str) -> Result<PathBuf, LinuxRuntimeConfigError> {
        let path = Path::new(value);
        if !is_bounded_absolute_path(path, MAX_WORKSPACE_PATH_BYTES) || path == Path::new("/") {
            return Err(LinuxRuntimeConfigError::Invalid);
        }
        Ok(path.to_path_buf())
    }

    fn is_bounded_absolute_path(path: &Path, maximum_bytes: usize) -> bool {
        path.is_absolute()
            && path.as_os_str().len() <= maximum_bytes
            && !path
                .components()
                .any(|component| matches!(component, std::path::Component::ParentDir))
    }

    fn parse_port(value: &str) -> Result<u16, LinuxRuntimeConfigError> {
        if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(LinuxRuntimeConfigError::Invalid);
        }
        let port = value
            .parse::<u16>()
            .map_err(|_| LinuxRuntimeConfigError::Invalid)?;
        if port == 0 {
            return Err(LinuxRuntimeConfigError::Invalid);
        }
        Ok(port)
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(crate) enum LinuxRelayError {
        InvalidListener,
        RuntimeUnavailable,
    }

    pub(crate) struct LinuxRelayListeners {
        capability: TcpListener,
        model: TcpListener,
    }

    impl LinuxRelayListeners {
        pub(crate) fn new(
            capability: TcpListener,
            model: TcpListener,
        ) -> Result<Self, LinuxRelayError> {
            validate_loopback_listener(&capability)?;
            validate_loopback_listener(&model)?;
            capability
                .set_nonblocking(true)
                .map_err(|_| LinuxRelayError::InvalidListener)?;
            model
                .set_nonblocking(true)
                .map_err(|_| LinuxRelayError::InvalidListener)?;
            Ok(Self { capability, model })
        }
    }

    pub(crate) fn bind_loopback_listeners(
        environment: &LinuxBridgeEnvironment,
    ) -> Result<LinuxRelayListeners, LinuxRelayError> {
        let capability = TcpListener::bind((Ipv4Addr::LOCALHOST, environment.capability_port))
            .map_err(|_| LinuxRelayError::InvalidListener)?;
        let model = TcpListener::bind((Ipv4Addr::LOCALHOST, environment.model_port))
            .map_err(|_| LinuxRelayError::InvalidListener)?;
        LinuxRelayListeners::new(capability, model)
    }

    fn validate_loopback_listener(listener: &TcpListener) -> Result<SocketAddr, LinuxRelayError> {
        let address = listener
            .local_addr()
            .map_err(|_| LinuxRelayError::InvalidListener)?;
        if !matches!(address, SocketAddr::V4(value) if value.ip().is_loopback() && value.port() != 0)
        {
            return Err(LinuxRelayError::InvalidListener);
        }
        Ok(address)
    }

    pub(crate) struct LinuxRelay {
        shutdown: Option<oneshot::Sender<()>>,
        task: Option<JoinHandle<Result<(), ()>>>,
    }

    impl LinuxRelay {
        pub(crate) fn start(
            listeners: LinuxRelayListeners,
            environment: LinuxBridgeEnvironment,
        ) -> Result<Self, LinuxRelayError> {
            let capability_address = validate_loopback_listener(&listeners.capability)?;
            let model_address = validate_loopback_listener(&listeners.model)?;
            if capability_address.port() != environment.capability_port
                || model_address.port() != environment.model_port
            {
                return Err(LinuxRelayError::InvalidListener);
            }

            let capability = TokioTcpListener::from_std(listeners.capability)
                .map_err(|_| LinuxRelayError::InvalidListener)?;
            let model = TokioTcpListener::from_std(listeners.model)
                .map_err(|_| LinuxRelayError::InvalidListener)?;
            let runtime = tokio::runtime::Handle::try_current()
                .map_err(|_| LinuxRelayError::RuntimeUnavailable)?;
            let (shutdown, shutdown_receiver) = oneshot::channel();
            let task = runtime.spawn(run_relay(
                capability,
                model,
                environment.capability_socket,
                environment.model_socket,
                shutdown_receiver,
            ));
            Ok(Self {
                shutdown: Some(shutdown),
                task: Some(task),
            })
        }

        pub(crate) async fn wait(&mut self) -> Result<(), ()> {
            let Some(task) = self.task.as_mut() else {
                return Ok(());
            };
            let result = task.await.map_err(|_| ())?;
            self.task = None;
            result
        }

        pub(crate) async fn shutdown(&mut self) {
            if let Some(shutdown) = self.shutdown.take() {
                let _ = shutdown.send(());
            }
            if let Some(task) = self.task.take() {
                let _ = task.await;
            }
        }
    }

    impl Drop for LinuxRelay {
        fn drop(&mut self) {
            if let Some(shutdown) = self.shutdown.take() {
                let _ = shutdown.send(());
            }
            if let Some(task) = self.task.take() {
                task.abort();
            }
        }
    }

    async fn run_relay(
        capability: TokioTcpListener,
        model: TokioTcpListener,
        capability_socket: PathBuf,
        model_socket: PathBuf,
        mut shutdown: oneshot::Receiver<()>,
    ) -> Result<(), ()> {
        let permits = Arc::new(Semaphore::new(MAX_RELAY_CONNECTIONS));
        let mut connections = JoinSet::new();
        let result = loop {
            tokio::select! {
                _ = &mut shutdown => break Ok(()),
                accepted = capability.accept() => {
                    let (stream, _) = accepted.map_err(|_| ())?;
                    spawn_relay_connection(
                        &mut connections,
                        stream,
                        capability_socket.clone(),
                        Arc::clone(&permits),
                    );
                }
                accepted = model.accept() => {
                    let (stream, _) = accepted.map_err(|_| ())?;
                    spawn_relay_connection(
                        &mut connections,
                        stream,
                        model_socket.clone(),
                        Arc::clone(&permits),
                    );
                }
                _ = connections.join_next(), if !connections.is_empty() => {}
            }
        };
        connections.abort_all();
        while connections.join_next().await.is_some() {}
        result
    }

    fn spawn_relay_connection(
        connections: &mut JoinSet<()>,
        tcp: TcpStream,
        socket_path: PathBuf,
        permits: Arc<Semaphore>,
    ) {
        let Ok(permit) = permits.try_acquire_owned() else {
            return;
        };
        connections.spawn(async move {
            let _permit = permit;
            let Ok(unix) = UnixStream::connect(socket_path).await else {
                return;
            };
            let _ = timeout(RELAY_TIMEOUT, relay_connection(tcp, unix)).await;
        });
    }

    async fn relay_connection(tcp: TcpStream, unix: UnixStream) -> io::Result<()> {
        let (tcp_read, tcp_write) = tcp.into_split();
        let (unix_read, unix_write) = unix.into_split();
        tokio::try_join!(
            copy_bounded(tcp_read, unix_write),
            copy_bounded(unix_read, tcp_write),
        )?;
        Ok(())
    }

    async fn copy_bounded<R, W>(mut reader: R, mut writer: W) -> io::Result<usize>
    where
        R: AsyncRead + Unpin,
        W: AsyncWrite + Unpin,
    {
        let mut copied = 0_usize;
        let mut buffer = [0_u8; RELAY_BUFFER_BYTES];
        loop {
            let read = reader.read(&mut buffer).await?;
            if read == 0 {
                writer.shutdown().await?;
                return Ok(copied);
            }
            copied = copied.checked_add(read).ok_or_else(relay_limit_error)?;
            if copied > MAX_RELAY_BYTES {
                return Err(relay_limit_error());
            }
            writer.write_all(&buffer[..read]).await?;
        }
    }

    fn relay_limit_error() -> io::Error {
        io::Error::new(io::ErrorKind::InvalidData, "bounded relay limit exceeded")
    }

    #[cfg(test)]
    mod tests {
        use std::collections::HashMap;
        use std::net::TcpListener;
        use std::os::unix::net::UnixListener;
        use std::time::Duration;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        use super::*;

        fn environment() -> HashMap<&'static str, String> {
            HashMap::from([
                (
                    CAPABILITY_SOCKET_ENVIRONMENT_KEY,
                    "/tmp/actestra-private/bridge/capability.sock".to_string(),
                ),
                (
                    MODEL_SOCKET_ENVIRONMENT_KEY,
                    "/tmp/actestra-private/bridge/model.sock".to_string(),
                ),
                (CAPABILITY_PORT_ENVIRONMENT_KEY, "41001".to_string()),
                (MODEL_PORT_ENVIRONMENT_KEY, "41002".to_string()),
                (
                    WORKSPACE_ROOT_ENVIRONMENT_KEY,
                    "/tmp/actestra-workspace".to_string(),
                ),
            ])
        }

        #[test]
        fn reads_exactly_the_closed_linux_bridge_environment() {
            let values = environment();
            let mut requested = Vec::<String>::new();
            let parsed = parse_linux_environment_with(|key| {
                requested.push(key.to_string());
                values.get(key).cloned()
            })
            .unwrap();

            assert_eq!(
                requested,
                vec![
                    CAPABILITY_SOCKET_ENVIRONMENT_KEY,
                    MODEL_SOCKET_ENVIRONMENT_KEY,
                    CAPABILITY_PORT_ENVIRONMENT_KEY,
                    MODEL_PORT_ENVIRONMENT_KEY,
                    WORKSPACE_ROOT_ENVIRONMENT_KEY,
                ]
            );
            assert_eq!(parsed.capability_port, 41001);
            assert_eq!(parsed.model_port, 41002);
            assert_eq!(
                parsed.private_root().unwrap(),
                PathBuf::from("/tmp/actestra-private")
            );
        }

        #[test]
        fn rejects_malformed_or_ambiguous_bridge_endpoints() {
            for (key, value) in [
                (CAPABILITY_PORT_ENVIRONMENT_KEY, "0"),
                (MODEL_PORT_ENVIRONMENT_KEY, "65536"),
                (CAPABILITY_SOCKET_ENVIRONMENT_KEY, "relative.sock"),
                (MODEL_SOCKET_ENVIRONMENT_KEY, "/tmp/../model.sock"),
                (WORKSPACE_ROOT_ENVIRONMENT_KEY, "/"),
            ] {
                let mut values = environment();
                values.insert(key, value.to_string());
                assert!(parse_linux_environment_with(|name| values.get(name).cloned()).is_err());
            }

            let mut values = environment();
            values.insert(MODEL_PORT_ENVIRONMENT_KEY, "41001".to_string());
            assert!(parse_linux_environment_with(|name| values.get(name).cloned()).is_err());
        }

        #[test]
        fn matches_the_main_owned_unix_socket_path_ceiling() {
            let exact = format!("/tmp/{}", "a".repeat(98));
            let widened = format!("/tmp/{}", "a".repeat(99));
            assert_eq!(exact.as_bytes().len(), 103);
            assert_eq!(widened.as_bytes().len(), 104);
            assert!(validate_socket_path(&exact).is_ok());
            assert!(validate_socket_path(&widened).is_err());
        }

        #[test]
        fn keeps_workspace_paths_independent_from_the_unix_socket_ceiling() {
            let mut values = environment();
            let workspace = format!("/tmp/{}", "w".repeat(200));
            assert!(workspace.as_bytes().len() > MAX_UNIX_SOCKET_PATH_BYTES);
            values.insert(WORKSPACE_ROOT_ENVIRONMENT_KEY, workspace.clone());

            let parsed = parse_linux_environment_with(|name| values.get(name).cloned()).unwrap();
            assert_eq!(parsed.workspace_root, PathBuf::from(workspace));
        }

        #[test]
        fn keeps_relay_bounds_closed() {
            assert_eq!(MAX_RELAY_CONNECTIONS, 8);
            assert_eq!(MAX_RELAY_BYTES, 256 * 1024);
        }

        #[tokio::test(flavor = "current_thread")]
        async fn forwards_each_fixed_port_to_its_matching_unix_socket_and_closes_idempotently() {
            let root = std::env::temp_dir()
                .join(format!("actestra-goose-relay-test-{}", std::process::id()));
            let bridge = root.join("bridge");
            std::fs::create_dir_all(&bridge).unwrap();
            let capability_socket = bridge.join("capability.sock");
            let model_socket = bridge.join("model.sock");
            let capability_server = UnixListener::bind(&capability_socket).unwrap();
            let model_server = UnixListener::bind(&model_socket).unwrap();
            capability_server.set_nonblocking(true).unwrap();
            model_server.set_nonblocking(true).unwrap();

            let capability_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let model_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let capability_port = capability_listener.local_addr().unwrap().port();
            let model_port = model_listener.local_addr().unwrap().port();
            capability_listener.set_nonblocking(true).unwrap();
            model_listener.set_nonblocking(true).unwrap();
            let environment = LinuxBridgeEnvironment {
                capability_socket,
                model_socket,
                capability_port,
                model_port,
                workspace_root: root.join("workspace"),
            };

            let capability_server = tokio::net::UnixListener::from_std(capability_server).unwrap();
            let model_server = tokio::net::UnixListener::from_std(model_server).unwrap();
            let capability_task = tokio::spawn(async move {
                let (mut stream, _) = capability_server.accept().await.unwrap();
                let mut request = [0_u8; 5];
                stream.read_exact(&mut request).await.unwrap();
                assert_eq!(&request, b"hello");
                stream.write_all(b"world").await.unwrap();
            });
            let model_task = tokio::spawn(async move {
                let (mut stream, _) = model_server.accept().await.unwrap();
                let mut request = [0_u8; 5];
                stream.read_exact(&mut request).await.unwrap();
                assert_eq!(&request, b"model");
                stream.write_all(b"reply").await.unwrap();
            });

            let listeners = LinuxRelayListeners::new(capability_listener, model_listener).unwrap();
            let mut relay = LinuxRelay::start(listeners, environment.clone()).unwrap();

            let mut capability_client =
                tokio::net::TcpStream::connect(("127.0.0.1", capability_port))
                    .await
                    .unwrap();
            capability_client.write_all(b"hello").await.unwrap();
            let mut capability_response = [0_u8; 5];
            capability_client
                .read_exact(&mut capability_response)
                .await
                .unwrap();
            assert_eq!(&capability_response, b"world");

            let mut model_client = tokio::net::TcpStream::connect(("127.0.0.1", model_port))
                .await
                .unwrap();
            model_client.write_all(b"model").await.unwrap();
            let mut model_response = [0_u8; 5];
            model_client.read_exact(&mut model_response).await.unwrap();
            assert_eq!(&model_response, b"reply");

            tokio::time::timeout(Duration::from_secs(1), capability_task)
                .await
                .unwrap()
                .unwrap();
            tokio::time::timeout(Duration::from_secs(1), model_task)
                .await
                .unwrap()
                .unwrap();
            relay.shutdown().await;
            relay.shutdown().await;
            drop(relay);
            let _ = std::fs::remove_dir_all(root);
        }
    }
}

#[cfg(target_os = "linux")]
pub(crate) use implementation::*;
