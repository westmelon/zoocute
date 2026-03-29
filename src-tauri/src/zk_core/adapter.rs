use crate::domain::{ConnectRequestDto, ConnectionStatusDto, LoadedTreeNodeDto, NodeDetailsDto};

pub trait ReadOnlyZkAdapter {
    fn connect(&self, request: ConnectRequestDto) -> Result<ConnectionStatusDto, String>;
    fn list_children(&self, path: &str) -> Result<Vec<LoadedTreeNodeDto>, String>;
    fn get_node(&self, path: &str) -> Result<NodeDetailsDto, String>;
}
