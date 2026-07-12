import {
  state,
  getProjectColor,
  saveProjectToDisk,
  renderApp
} from '../main.js';
import { openModal, showDeleteConfirm } from './modal.js';
import { selectFile, selectDirectory } from '../file-system.js';
import { addProjectHandle } from '../main.js';


const STANDARD_COLUMNS = ['backlog', 'todo', 'in progress', 'doing', 'review', 'done', 'completed'];

/**
 * Helper to sort column names logically
 */
function getColumnOrderValue(name) {
  const norm = name.toLowerCase().trim();
  const idx = STANDARD_COLUMNS.indexOf(norm);
  return idx === -1 ? 999 : idx;
}

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Ranks a task by its #priority-<level> tag (critical highest, then high,
 * medium, low). Untagged tasks sort after all prioritized ones.
 */
function getPriorityRank(task) {
  if (!task.tags) return 4;
  const match = task.tags.map((t) => t.toLowerCase()).find((t) => /^#priority-(critical|high|medium|low)$/.test(t));
  if (!match) return 4;
  const level = match.replace('#priority-', '');
  return PRIORITY_RANK[level] ?? 4;
}

/**
 * Renders the Kanban Board layout.
 */
export function renderBoard() {
  const boardContainer = document.getElementById('board-container');
  if (!boardContainer) return;
  
  boardContainer.innerHTML = '';
  
  // 1. Check if we have active projects (using unique id)
  const activeProjects = state.projects.filter(p => state.selectedProjectIds.includes(p.id));
  
  if (state.projects.length === 0) {
    renderEmptyState(boardContainer, 'connect');
    return;
  }
  
  if (activeProjects.length === 0) {
    renderEmptyState(boardContainer, 'select');
    return;
  }
  
  // Check if all active projects require permission
  const needsPermission = activeProjects.every(p => !p.permissionGranted);
  if (needsPermission) {
    renderEmptyState(boardContainer, 'authorize');
    return;
  }
  
  // 2. Gather unique columns across all active, authorized projects
  const columnMap = new Map(); // Name -> Array of tasks { task, project }
  
  activeProjects.forEach(project => {
    if (!project.permissionGranted) return;
    
    project.data.columns.forEach(col => {
      const colName = col.name;
      if (!columnMap.has(colName)) {
        columnMap.set(colName, {
          level: col.level || 2,
          tasks: []
        });
      }
      
      col.tasks.forEach(task => {
        // Apply search query filter
        if (state.searchQuery) {
          const query = state.searchQuery;
          const matchesTitle = task.title.toLowerCase().includes(query);
          const matchesDesc = task.description.some(line => line.toLowerCase().includes(query));
          const matchesTags = task.tags.some(tag => tag.toLowerCase().includes(query));
          
          if (!matchesTitle && !matchesDesc && !matchesTags) {
            return; // Skip if doesn't match search
          }
        }
        
        // Apply hide completed filter
        if (state.hideCompleted && task.completed) {
          return; // Skip if completed
        }
        
        columnMap.get(colName).tasks.push({
          task,
          project
        });
      });
    });
  });
  
  // Gather unique column names in their natural file order across all active projects
  const sortedColumnNames = [];
  activeProjects.forEach(project => {
    if (!project.permissionGranted) return;
    project.data.columns.forEach(col => {
      if (!sortedColumnNames.includes(col.name)) {
        sortedColumnNames.push(col.name);
      }
    });
  });
  
  if (sortedColumnNames.length === 0) {
    renderEmptyState(boardContainer, 'empty-projects');
    return;
  }
  
  // 3. Render Columns
  sortedColumnNames.forEach(colName => {
    const colData = columnMap.get(colName);
    
    const colEl = document.createElement('div');
    colEl.className = 'board-column';
    colEl.dataset.column = colName;
    
    // Header
    const headerEl = document.createElement('div');
    headerEl.className = 'column-header';
    
    const titleWrapper = document.createElement('div');
    titleWrapper.className = 'column-title-wrapper';
    
    const dot = document.createElement('div');
    dot.className = 'column-dot';
    
    const title = document.createElement('span');
    title.className = 'column-title';
    title.textContent = colName;
    title.title = colName;
    
    // Double click to rename column
    title.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      titleWrapper.draggable = false;
      
      const input = document.createElement('input');
      input.type = 'text';
      input.value = colName;
      input.style.width = '120px';
      input.style.background = 'var(--bg-input)';
      input.style.border = '1px solid var(--color-primary)';
      input.style.color = 'var(--text-primary)';
      input.style.borderRadius = '4px';
      input.style.padding = '2px 6px';
      input.style.fontSize = '0.9rem';
      input.style.fontWeight = '700';
      
      const finishRename = async () => {
        const val = input.value.trim();
        titleWrapper.draggable = true;
        if (val && val !== colName) {
          await handleColumnRename(colName, val);
        } else {
          title.textContent = colName;
        }
      };
      
      input.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter') {
          evt.preventDefault();
          finishRename();
        } else if (evt.key === 'Escape') {
          title.textContent = colName;
          titleWrapper.draggable = true;
        }
      });
      
      input.addEventListener('blur', finishRename);
      
      title.innerHTML = '';
      title.appendChild(input);
      input.focus();
      input.select();
    });
    
    const count = document.createElement('span');
    count.className = 'column-count';
    count.textContent = colData.tasks.length;
    
    titleWrapper.appendChild(dot);
    titleWrapper.appendChild(title);
    titleWrapper.appendChild(count);
    
    const addBtn = document.createElement('button');
    addBtn.className = 'column-add-task-btn';
    addBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>
    `;
    addBtn.title = `Add task to ${colName}`;
    
    headerEl.appendChild(titleWrapper);
    headerEl.appendChild(addBtn);
    colEl.appendChild(headerEl);
    
    // Make column header title draggable for column reordering
    titleWrapper.draggable = true;
    titleWrapper.addEventListener('dragstart', (e) => {
      headerEl.classList.add('column-dragging');
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'column',
        colName: colName
      }));
      e.dataTransfer.effectAllowed = 'move';
    });
    
    titleWrapper.addEventListener('dragend', async () => {
      headerEl.classList.remove('column-dragging');
      await handleColumnDragEnd();
    });
    
    colEl.addEventListener('dragover', (e) => {
      const draggingHeader = document.querySelector('.column-header.column-dragging');
      if (draggingHeader) {
        e.preventDefault();
        const draggedColEl = draggingHeader.closest('.board-column');
        if (draggedColEl !== colEl) {
          const boardContainer = document.getElementById('board-container');
          const rect = colEl.getBoundingClientRect();
          const midpoint = rect.left + rect.width / 2;
          if (e.clientX < midpoint) {
            boardContainer.insertBefore(draggedColEl, colEl);
          } else {
            boardContainer.insertBefore(draggedColEl, colEl.nextSibling);
          }
        }
      }
    });
    
    // Cards list container
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'cards-container';

    // Render Cards, highest #priority-* tag first (stable sort keeps
    // same-priority / untagged cards in their existing relative order)
    colData.tasks.sort((a, b) => getPriorityRank(a.task) - getPriorityRank(b.task));
    colData.tasks.forEach(({ task, project }) => {
      const cardEl = renderTaskCard(task, project, colName);
      cardsContainer.appendChild(cardEl);
    });
    
    colEl.appendChild(cardsContainer);
    boardContainer.appendChild(colEl);
    
    // Add task click
    addBtn.addEventListener('click', () => {
      const newTask = {
        id: Math.random().toString(36).substring(2, 9),
        title: '',
        completed: colName.toLowerCase().trim() === 'done' || colName.toLowerCase().trim() === 'completed',
        description: [],
        subtasks: [],
        tags: [],
        indentLevel: 0
      };
      
      const targetProj = activeProjects.find(p => p.permissionGranted);
      if (targetProj) {
        openModal(newTask, targetProj.id, colName, true); // Pass ID instead of name
      }
    });
    
    // Drag & Drop Column Events
    cardsContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      colEl.classList.add('drag-over');
      
      const afterElement = getDragAfterElement(cardsContainer, e.clientY);
      const draggingCard = document.querySelector('.task-card.dragging');
      if (draggingCard) {
        if (afterElement == null) {
          cardsContainer.appendChild(draggingCard);
        } else {
          cardsContainer.insertBefore(draggingCard, afterElement);
        }
      }
    });
    
    cardsContainer.addEventListener('dragleave', () => {
      colEl.classList.remove('drag-over');
    });
    
    cardsContainer.addEventListener('drop', async (e) => {
      e.preventDefault();
      colEl.classList.remove('drag-over');
      
      const rawData = e.dataTransfer.getData('text/plain');
      if (!rawData) return;
      
      try {
        const { taskId, projectId, sourceCol } = JSON.parse(rawData);
        const targetColName = colName;
        
        const children = [...cardsContainer.querySelectorAll('.task-card')];
        const targetIndex = children.findIndex(child => child.dataset.id === taskId);
        
        if (sourceCol === targetColName) {
          await handleTaskReorder(projectId, taskId, targetColName, targetIndex);
        } else {
          await handleTaskMove(projectId, taskId, sourceCol, targetColName, targetIndex);
        }
      } catch (err) {
        console.error('Error handling drop:', err);
      }
    });
  });
}

/**
 * Renders a single task card element.
 */
function renderTaskCard(task, project, colName) {
  const card = document.createElement('div');
  card.className = `task-card ${task.completed ? 'completed' : ''}`;
  card.draggable = true;
  card.dataset.id = task.id;
  card.dataset.project = project.id;
  card.dataset.column = colName;
  
  // Header with project tag pill (using display label)
  const header = document.createElement('div');
  header.className = 'card-header';

  const headerLeft = document.createElement('div');
  headerLeft.className = 'card-header-left';

  const localOnlyBtn = document.createElement('button');
  localOnlyBtn.type = 'button';
  localOnlyBtn.className = `card-local-only-btn ${task.localOnly ? 'active' : ''}`;
  localOnlyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6"></path><path d="M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
  localOnlyBtn.title = task.localOnly
    ? 'Local only — will not be pushed to Azure DevOps. Click to allow pushing again.'
    : 'Keep local only — click to skip pushing this card to Azure DevOps.';
  localOnlyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    task.localOnly = !task.localOnly;
    await saveProjectToDisk(project);
    renderApp();
  });

  const projectPill = document.createElement('span');
  projectPill.className = 'project-pill';
  projectPill.style.backgroundColor = getProjectColor(project.id);
  projectPill.style.color = '#fff';
  projectPill.textContent = project.label;
  projectPill.title = `${project.label} (${project.name})`;

  headerLeft.appendChild(localOnlyBtn);
  headerLeft.appendChild(projectPill);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'card-delete-btn';
  deleteBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>`;
  deleteBtn.title = 'Delete task';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showDeleteConfirm(task, project, colName);
  });

  header.appendChild(headerLeft);
  header.appendChild(deleteBtn);
  card.appendChild(header);
  
  // Title
  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = task.title.replace(/#[\w-]+/g, '').trim();
  card.appendChild(title);
  
  // Subtasks progress
  if (task.subtasks && task.subtasks.length > 0) {
    const completedSubCount = task.subtasks.filter(s => s.completed).length;
    const totalSubCount = task.subtasks.length;
    const percent = Math.round((completedSubCount / totalSubCount) * 100);
    
    const progressEl = document.createElement('div');
    progressEl.className = 'card-subtask-progress';
    progressEl.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-4 4 4 4"></path><path d="m19 11-4 4 4 4"></path><path d="M5 15h14"></path><path d="M19 9V5c0-1-1-2-2-2H7c-1 0-2 1-2 2v4"></path></svg>
      <span>${completedSubCount}/${totalSubCount}</span>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill ${percent === 100 ? 'complete' : ''}" style="width: ${percent}%"></div>
      </div>
    `;
    card.appendChild(progressEl);
  }
  
  // Tags
  if (task.tags && task.tags.length > 0) {
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'card-tags';
    
    task.tags.forEach(tag => {
      const tagEl = document.createElement('span');
      tagEl.className = 'hash-tag';
      tagEl.textContent = tag;
      tagsContainer.appendChild(tagEl);
    });
    
    card.appendChild(tagsContainer);
  }
  
  // Edit click
  card.addEventListener('click', () => {
    openModal(task, project.id, colName, false); // Pass ID instead of name
  });
  
  // Drag start
  card.addEventListener('dragstart', (e) => {
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', JSON.stringify({
      taskId: task.id,
      projectId: project.id,
      sourceCol: colName
    }));
    e.dataTransfer.effectAllowed = 'move';
  });
  
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
  });
  
  return card;
}

/**
 * Finds which element insertion should place dragging node before
 */
function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.task-card:not(.dragging)')];
  
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

/**
 * Handles reordering within the same column
 */
async function handleTaskReorder(projectId, taskId, colName, targetIndex) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  
  const col = project.data.columns.find(c => c.name === colName);
  if (!col) return;
  
  const taskIndex = col.tasks.findIndex(t => t.id === taskId);
  if (taskIndex === -1) return;
  
  const [task] = col.tasks.splice(taskIndex, 1);
  const insertIndex = targetIndex === -1 ? col.tasks.length : targetIndex;
  
  col.tasks.splice(insertIndex, 0, task);
  
  await saveProjectToDisk(project);
  renderApp();
}

/**
 * Handles moving a task to a different column
 */
async function handleTaskMove(projectId, taskId, sourceColName, targetColName, targetIndex) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  
  const sourceCol = project.data.columns.find(c => c.name === sourceColName);
  const targetCol = project.data.columns.find(c => c.name === targetColName);
  
  if (!sourceCol || !targetCol) return;
  
  const taskIndex = sourceCol.tasks.findIndex(t => t.id === taskId);
  if (taskIndex === -1) return;
  
  const [task] = sourceCol.tasks.splice(taskIndex, 1);
  
  // Set completion
  task.completed = targetColName.toLowerCase().trim() === 'done' || targetColName.toLowerCase().trim() === 'completed';
  
  const insertIndex = targetIndex === -1 ? targetCol.tasks.length : targetIndex;
  targetCol.tasks.splice(insertIndex, 0, task);
  
  await saveProjectToDisk(project);
  renderApp();
}

/**
 * Renders empty state panels on the board.
 */
function renderEmptyState(container, type) {
  if (type === 'connect') {
    container.innerHTML = `
      <div class="empty-state-board">
        <div class="empty-icon">📂</div>
        <h2>Connect Markdown Files or Folders to Start</h2>
        <p>This board visualizes your local todo.md files as a drag-and-drop Kanban interface.</p>
        <p class="warning-note">🔒 Your data stays 100% offline. Files are read and written directly on your device.</p>
        <div style="display: flex; gap: 12px; margin-top: 8px;">
          <button id="connect-first-file-btn" class="btn btn-primary" title="Connect a single markdown checklist file like todo.md. Use this when you just want one file on the board.">Connect a file</button>
          <button id="connect-first-folder-btn" class="btn btn-secondary" title="Connect a project folder and auto-load its todo.md or markdown checklist file from that directory.">Connect a folder</button>
        </div>
        <div class="empty-state-tooltip-text">
          <p><strong>File: </strong>Best for markdown checklist files with different names (e.g., tasks.md, holiday_checklist.md).</p>
          <p><strong>Folder: </strong>Best for multiple projects with TODO.md files. open a project folder and auto-discover its todo file.</p>
        </div>
      </div>
    `;
    
    // Bind buttons
    const fileBtn = document.getElementById('connect-first-file-btn');
    if (fileBtn) {
      fileBtn.addEventListener('click', async () => {
        try {
          const handle = await selectFile();
          await addProjectHandle(handle, 'file');
        } catch (err) {
          console.warn('File selection canceled:', err);
        }
      });
    }
    
    const folderBtn = document.getElementById('connect-first-folder-btn');
    if (folderBtn) {
      folderBtn.addEventListener('click', async () => {
        try {
          const handle = await selectDirectory();
          await addProjectHandle(handle, 'directory');
        } catch (err) {
          console.warn('Folder selection canceled:', err);
        }
      });
    }
  } else if (type === 'select') {
    container.innerHTML = `
      <div class="empty-state-board">
        <div class="empty-icon">📁</div>
        <h2>Select Projects</h2>
        <p>Select one or more connected files/folders in the sidebar to visualize them on the board.</p>
      </div>
    `;
  } else if (type === 'authorize') {
    container.innerHTML = `
      <div class="empty-state-board">
        <div class="empty-icon">🔒</div>
        <h2>Authorization Required</h2>
        <p>Browsers require authorization to access files after a reload. Please click <b>"🔒 Click to authorize"</b> next to your projects in the sidebar to load the board.</p>
      </div>
    `;
  } else if (type === 'empty-projects') {
    container.innerHTML = `
      <div class="empty-state-board">
        <div class="empty-icon">📝</div>
        <h2>No Tasks Found</h2>
        <p>This markdown file does not contain any checklists or headers yet.</p>
        <button id="create-first-task-btn" class="btn btn-primary">Create Your First Column & Task</button>
      </div>
    `;
    
    const btn = document.getElementById('create-first-task-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        const activeProj = state.projects.find(p => p.permissionGranted && state.selectedProjectIds.includes(p.id));
        if (activeProj) {
          if (activeProj.data.columns.length === 0) {
            activeProj.data.columns.push({ name: 'Todo', level: 2, tasks: [] });
          }
          const newTask = {
            id: Math.random().toString(36).substring(2, 9),
            title: '',
            completed: false,
            description: [],
            subtasks: [],
            tags: [],
            indentLevel: 0
          };
          openModal(newTask, activeProj.id, activeProj.data.columns[0].name, true);
        }
      });
    }
  }
}

/**
 * Handles column reordering persistence after dragging ends
 */
async function handleColumnDragEnd() {
  const boardContainer = document.getElementById('board-container');
  if (!boardContainer) return;
  
  const newOrder = [...boardContainer.querySelectorAll('.board-column')].map(el => el.dataset.column);
  const activeProjects = state.projects.filter(p => state.selectedProjectIds.includes(p.id));
  
  for (const project of activeProjects) {
    if (!project.permissionGranted) continue;
    project.data.columns.sort((a, b) => {
      const idxA = newOrder.indexOf(a.name);
      const idxB = newOrder.indexOf(b.name);
      const valA = idxA === -1 ? 999 : idxA;
      const valB = idxB === -1 ? 999 : idxB;
      return valA - valB;
    });
    await saveProjectToDisk(project);
  }
  
  renderApp();
}

/**
 * Handles column renaming across all active projects
 */
async function handleColumnRename(oldName, newName) {
  const activeProjects = state.projects.filter(p => state.selectedProjectIds.includes(p.id));
  
  for (const project of activeProjects) {
    if (!project.permissionGranted) continue;
    const col = project.data.columns.find(c => c.name === oldName);
    if (col) {
      col.name = newName;
      await saveProjectToDisk(project);
    }
  }
  
  renderApp();
}
