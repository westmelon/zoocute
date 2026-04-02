# Zoocute User Guide

Zoocute is a desktop ZooKeeper client for browsing nodes, inspecting metadata, editing text values, checking operation logs, and running parser plugins on node content.

For the Chinese version, see [docs/USER_GUIDE.zh-CN.md](docs/USER_GUIDE.zh-CN.md).  
For developer documentation, see [README.md](README.md) and [docs/README.zh-CN.md](docs/README.zh-CN.md).

## Main Screens

Zoocute has three main work areas:

- `Connections`: create, save, test, connect, disconnect, and remove connection profiles
- `Browse`: inspect the node tree, search loaded nodes, open node details, edit content, compare changes, and manage nodes
- `Log`: review recent ZooKeeper operation records and filter them

## Add a Connection

1. Open the `Connections` tab.
2. Click `+ New`.
3. Fill in the connection form:
   - `Connection String`: ZooKeeper address such as `127.0.0.1:2181`
   - `Name`: optional display name
   - `Username`: optional
   - `Password`: optional
   - `Timeout (ms)`: request timeout
4. Click `Test Connection` to validate the profile.
5. Click `Save` to keep the connection for later use.
6. Click the connect button in the connection card to open a live session.

## Browse Nodes

After a connection is active:

1. Open the `Browse` tab.
2. Use the left panel to expand the node tree.
3. Click a node to open its details.
4. Review metadata such as version, timestamps, children count, and data size.

Search behavior:

- Type in the search box above the tree.
- Search works against nodes already loaded into the current session index.
- The app also builds a larger search index in the background, so results can improve after the connection has been open for a while.

## Edit a Node

For editable nodes:

1. Open a node from the tree.
2. Enter edit mode.
3. Change the node value in the editor.
4. Save the draft back to ZooKeeper.

Important notes:

- Binary or non-editable content may not support direct editing.
- If you move away from a dirty draft, the app can ask you to confirm whether to discard changes.

## Compare with Server Value

When you want to verify changes before saving:

1. Open the node in the editor.
2. Use the diff action in the toolbar.
3. Zoocute fetches the current server value and compares it with your local draft.

This is useful when a node may have changed on the server while you were editing locally.

## Create or Delete Nodes

Zoocute supports basic tree maintenance:

- Create a node from the browsing workflow
- Delete a node
- Some delete flows may support recursive removal depending on the target node and action used

Be careful when performing write operations on shared environments.

## Parser Plugins

Parser plugins help turn raw node bytes into domain-specific readable text.

Typical workflow:

1. Open a node.
2. Choose a parser plugin from the toolbar.
3. Run the parser.
4. Review the generated output in plugin view.

If a plugin fails:

- Zoocute shows the plugin error
- You can switch back to raw view
- Invalid plugin manifests may be skipped automatically

## Operation Logs

Open the `Log` tab to review recent ZooKeeper activity.

You can:

- Refresh the latest entries
- Filter by success state
- Filter by connection ID
- Clear the local log list

The log view is helpful when checking whether a connect, read, save, create, delete, or plugin-related action succeeded.

## Troubleshooting

### Connection fails

- Check that the ZooKeeper address is reachable
- Confirm the cluster is running
- If authentication is required, verify username and password
- If the error suggests a timeout, try increasing the timeout and retesting

### Search cannot find a node

- Wait for more tree data to finish loading
- Expand the relevant parent path first
- Retry after the current session has had more time to build the index

### Save is rejected

- Confirm your account has write permission
- Check whether the node content is editable text rather than binary data
- Re-open the node and compare against the latest server value

### Plugin does not appear

- Make sure the plugin is installed correctly with a valid `plugin.json`
- Reopen the node or restart the app so discovery runs again

## Safety Tips

- Test write actions in a non-production environment first
- Double-check target paths before deleting nodes
- Use saved connection names that clearly identify the environment
- Review logs after sensitive operations
