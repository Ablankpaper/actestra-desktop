use std::env;
use std::io::Read;
use std::os::unix::io::FromRawFd;

fn watch_parent_liveness() {
    let Ok(raw_fd) = env::var("ACTESTRA_PARENT_LIVENESS_FD") else {
        return;
    };
    let Ok(raw_fd) = raw_fd.parse::<i32>() else {
        return;
    };
    let process_id = unsafe { libc::getpid() };
    // sandbox-exec normally preserves the detached process group, but make
    // that ownership explicit before accepting the liveness channel. This
    // prevents a parent-death cleanup from ever signalling the supervisor's
    // group if a launcher changes its process-group semantics.
    let mut process_group = unsafe { libc::getpgrp() };
    // A detached macOS child is commonly already a session/process-group
    // leader. Calling setpgid on that session leader returns EPERM even
    // though the desired isolation is already in place. Only establish a
    // group when the launcher has not done so for us.
    if process_group != process_id {
        if unsafe { libc::setpgid(0, process_id) } != 0 {
            eprintln!("ACTESTRA_GOOSE_RUNNER_FAILED: could not establish process group");
            std::process::exit(1);
        }
        process_group = unsafe { libc::getpgrp() };
    }
    if process_group != process_id {
        eprintln!("ACTESTRA_GOOSE_RUNNER_FAILED: runner is not its process-group leader");
        std::process::exit(1);
    }
    std::thread::spawn(move || {
        // SAFETY: fd 3 is opened by Main as the read end of a CLOEXEC pipe and
        // remains owned by this runner until the supervisor disappears.
        let mut pipe = unsafe { std::fs::File::from_raw_fd(raw_fd) };
        let mut byte = [0_u8; 1];
        loop {
            match pipe.read(&mut byte) {
                Ok(0) => {
                    // The runner is the process-group leader. Terminate the
                    // complete group before exiting so descendants cannot be
                    // orphaned when Main dies unexpectedly.
                    unsafe {
                        libc::signal(libc::SIGTERM, libc::SIG_IGN);
                        libc::kill(-process_group, libc::SIGTERM);
                    }
                    std::process::exit(0);
                }
                Ok(_) => {}
                Err(_) => return,
            }
        }
    });
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    watch_parent_liveness();
    if let Err(error) = goose::acp::server::run(Vec::new(), false).await {
        eprintln!("ACTESTRA_GOOSE_RUNNER_FAILED: {error:#}");
        std::process::exit(1);
    }
}
