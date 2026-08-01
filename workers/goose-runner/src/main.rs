#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    if let Err(error) = goose::acp::server::run(Vec::new(), false).await {
        eprintln!("ACTESTRA_GOOSE_RUNNER_FAILED: {error:#}");
        std::process::exit(1);
    }
}
