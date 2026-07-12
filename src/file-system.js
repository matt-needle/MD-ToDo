/**
 * File System Access API and IndexedDB Helpers (Version 2 with Unique IDs and Directory Scan Support)
 */

const DB_NAME = 'MarkdownKanbanDB';
const STORE_NAME = 'fileHandles';

/**
 * Opens the IndexedDB database. We increment version to 2 to migrate keyPath from 'name' to 'id'.
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Saves a project's details (including handle) to IndexedDB.
 * @param {object} project - { id, label, name, type, handle, fileName }
 */
export async function saveProjectHandle(project) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ 
      id: project.id, 
      label: project.label, 
      name: project.name, 
      type: project.type, 
      handle: project.handle,
      fileName: project.fileName 
    });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieves all stored project details from IndexedDB.
 * @returns {Promise<object[]>}
 */
export async function getStoredProjects() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Removes a project entry from IndexedDB.
 * @param {string} id 
 */
export async function removeStoredProject(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Verifies and requests read/write permissions for a file/directory handle.
 * @param {FileSystemHandle} handle 
 * @param {boolean} withWrite - True to request readwrite, false for readonly.
 * @returns {Promise<boolean>} True if permission is granted, false otherwise.
 */
export async function verifyPermission(handle, withWrite = true) {
  const opts = { mode: withWrite ? 'readwrite' : 'read' };
  
  try {
    if ((await handle.queryPermission(opts)) === 'granted') {
      return true;
    }
    if ((await handle.requestPermission(opts)) === 'granted') {
      return true;
    }
  } catch (err) {
    console.error('Permission verification failed', err);
  }
  return false;
}

/**
 * Opens the file picker dialog to let the user select a markdown file.
 * @returns {Promise<FileSystemFileHandle>} The selected file handle.
 */
export async function selectFile() {
  if (!window.showOpenFilePicker) {
    throw new Error('Your browser does not support the File System Access API. Please use a modern version of Chrome, Edge, or Opera.');
  }
  
  const [handle] = await window.showOpenFilePicker({
    types: [
      {
        description: 'Markdown Checklists',
        accept: {
          'text/markdown': ['.md', '.markdown', '.todo.md']
        }
      }
    ],
    excludeAcceptAllOption: true,
    multiple: false
  });
  
  return handle;
}

/**
 * Opens the directory picker dialog to let the user select a project directory.
 * @returns {Promise<FileSystemDirectoryHandle>} The selected directory handle.
 */
export async function selectDirectory() {
  if (!window.showDirectoryPicker) {
    throw new Error('Your browser does not support directory picking. Please use a modern version of Chrome, Edge, or Opera.');
  }
  
  const handle = await window.showDirectoryPicker();
  return handle;
}

/**
 * Scans a directory for a checklist file.
 * Looks for todo.md, TODO.md, todo.markdown, or any markdown file.
 * @param {FileSystemDirectoryHandle} dirHandle 
 * @returns {Promise<{fileHandle: FileSystemFileHandle, fileName: string}|null>}
 */
export async function scanDirectoryForTodo(dirHandle) {
  const targetNames = [
    'todo.md', 
    'TODO.md', 
    'todo.markdown', 
    'TODO.markdown', 
    'todo', 
    'TODO', 
    'tasks.md', 
    'TASKS.md'
  ];
  
  // 1. Try standard filenames
  for (const name of targetNames) {
    try {
      const fileHandle = await dirHandle.getFileHandle(name, { create: false });
      if (fileHandle) {
        return { fileHandle, fileName: name };
      }
    } catch (err) {
      // File not found, proceed to next
    }
  }
  
  // 2. Scan for any file ending with .md or .markdown
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && (entry.name.endsWith('.md') || entry.name.endsWith('.markdown'))) {
        return { fileHandle: entry, fileName: entry.name };
      }
    }
  } catch (err) {
    console.error('Error scanning folder contents:', err);
  }
  
  return null;
}

/**
 * Reads a project's `.mdtodo-sync.json` sidecar config, if present, to find
 * the local Pull/Push endpoints that own this project's data. Only possible
 * for directory-connected projects (a bare file handle has no parent
 * directory to look in) — this is intentional: a project only gets working
 * Pull/Push buttons if it explicitly declares its own endpoints, so one
 * project's sync can never accidentally fire against a different project's
 * board/backend.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Promise<{pullUrl: string|null, pushUrl: string|null}>}
 */
export async function readSyncConfig(dirHandle) {
  try {
    const fileHandle = await dirHandle.getFileHandle('.mdtodo-sync.json', { create: false });
    const content = await readFileContent(fileHandle);
    const config = JSON.parse(content);
    return {
      pullUrl: typeof config.pullUrl === 'string' && config.pullUrl ? config.pullUrl : null,
      pushUrl: typeof config.pushUrl === 'string' && config.pushUrl ? config.pushUrl : null,
    };
  } catch (err) {
    return { pullUrl: null, pushUrl: null };
  }
}

/**
 * Reads content from a file handle.
 * @param {FileSystemFileHandle} handle 
 * @returns {Promise<string>} File content.
 */
export async function readFileContent(handle) {
  const file = await handle.getFile();
  return await file.text();
}

/**
 * Writes content to a file handle.
 * @param {FileSystemFileHandle} handle 
 * @param {string} content 
 */
export async function writeFileContent(handle, content) {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}
