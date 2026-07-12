import {
  state,
  getProjectColor,
  saveProjectToDisk,
  renderApp
} from '../main.js';

let activeTask = null;
let activeProjectId = null;
let activeColumnName = null;
let isCreatingNew = false;

let pendingDelete = null;

export function initConfirmDeleteModal() {
  const modal = document.getElementById('confirm-delete-modal');
  const cancelBtn = document.getElementById('confirm-delete-cancel-btn');
  const deleteBtn = document.getElementById('confirm-delete-btn');
  if (!modal) return;

  const close = () => {
    modal.classList.remove('open');
    pendingDelete = null;
  };

  cancelBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });

  deleteBtn.addEventListener('click', async () => {
    if (!pendingDelete) return;
    const { task, project, colName, onAfterDelete } = pendingDelete;
    const col = project.data.columns.find(c => c.name === colName);
    if (col) {
      col.tasks = col.tasks.filter(t => t.id !== task.id);
      await saveProjectToDisk(project);
      renderApp();
    }
    if (onAfterDelete) onAfterDelete();
    close();
  });
}

export function showDeleteConfirm(task, project, colName, onAfterDelete) {
  pendingDelete = { task, project, colName, onAfterDelete };
  const titleEl = document.getElementById('confirm-delete-title');
  if (titleEl) titleEl.textContent = task.title.replace(/#[\w-]+/g, '').trim();
  const warningEl = document.getElementById('confirm-delete-subtask-warning');
  if (warningEl) {
    const unfinished = task.subtasks ? task.subtasks.filter(s => !s.completed).length : 0;
    warningEl.textContent = unfinished > 0
      ? `This item has ${unfinished} unfinished subtask${unfinished > 1 ? 's' : ''}.`
      : '';
  }
  document.getElementById('confirm-delete-modal').classList.add('open');
}

/**
 * Initializes modal DOM event listeners.
 */
export function initModal() {
  const modalOverlay = document.getElementById('task-modal');
  const closeBtn = document.getElementById('modal-close-btn');
  const cancelBtn = document.getElementById('cancel-task-btn');
  const addSubtaskBtn = document.getElementById('add-subtask-btn');
  const deleteBtn = document.getElementById('delete-task-btn');
  const taskForm = document.getElementById('task-form');
  
  if (!modalOverlay) return;
  
  const closeModal = () => {
    modalOverlay.classList.remove('open');
    activeTask = null;
  };
  
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay.classList.contains('open')) {
      closeModal();
    }
  });
  
  addSubtaskBtn.addEventListener('click', () => {
    const list = document.getElementById('subtasks-list');
    if (list) {
      list.appendChild(createSubtaskRow('', false));
    }
  });
  
  deleteBtn.addEventListener('click', () => {
    if (isCreatingNew) {
      closeModal();
      return;
    }

    const project = state.projects.find(p => p.id === activeProjectId);
    if (project) {
      showDeleteConfirm(activeTask, project, activeColumnName, closeModal);
    }
  });
  
  taskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const project = state.projects.find(p => p.id === activeProjectId);
    if (!project) return;
    
    const titleVal = document.getElementById('task-title-input').value.trim();
    const descText = document.getElementById('task-description-input').value;
    const descLines = descText.split('\n');
    
    const tagsText = document.getElementById('task-tags-input').value;
    const parsedTags = (tagsText.match(/#[\w-]+/g) || []).map(t => t.toLowerCase());
    
    const subtaskRows = document.querySelectorAll('.subtask-edit-item');
    const subtasks = [];
    subtaskRows.forEach(row => {
      const chk = row.querySelector('input[type="checkbox"]').checked;
      const text = row.querySelector('input[type="text"]').value.trim();
      if (text) {
        subtasks.push({
          title: text,
          completed: chk,
          listType: row.dataset.listType || 'bullet',
          hasCheckbox: row.dataset.hasCheckbox === 'true',
          indent: row.dataset.indent || '  ',
          bulletChar: row.dataset.bulletChar || '-'
        });
      }
    });
    
    activeTask.title = titleVal;
    activeTask.description = descLines;
    activeTask.tags = parsedTags;
    activeTask.subtasks = subtasks;
    activeTask.localOnly = document.getElementById('task-local-only-input').checked;
    
    // Sync tags in title
    let cleanTitle = titleVal.replace(/#[\w-]+/g, '').trim();
    if (parsedTags.length > 0) {
      cleanTitle = `${cleanTitle} ${parsedTags.join(' ')}`;
    }
    activeTask.title = cleanTitle;
    
    if (isCreatingNew) {
      let col = project.data.columns.find(c => c.name === activeColumnName);
      if (!col) {
        col = { name: activeColumnName, level: 2, tasks: [] };
        project.data.columns.push(col);
      }
      col.tasks.push(activeTask);
    }
    
    await saveProjectToDisk(project);
    renderApp();
    closeModal();
  });
}

function createSubtaskRow(title, completed, listType = 'bullet', hasCheckbox = true, indent = '  ', bulletChar = '-') {
  const row = document.createElement('div');
  row.className = 'subtask-edit-item';
  row.dataset.listType = listType;
  row.dataset.hasCheckbox = hasCheckbox;
  row.dataset.indent = indent;
  row.dataset.bulletChar = bulletChar;
  
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.checked = completed;
  
  const txt = document.createElement('input');
  txt.type = 'text';
  txt.value = title;
  txt.placeholder = 'Subtask description...';
  
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'subtask-remove-btn';
  del.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
  `;
  del.title = 'Remove subtask';
  
  del.addEventListener('click', () => {
    row.remove();
  });
  
  row.appendChild(chk);
  row.appendChild(txt);
  row.appendChild(del);
  
  return row;
}

/**
 * Opens the task detail modal.
 * @param {object} task 
 * @param {string} projectId - Unique ID of project
 * @param {string} columnName 
 * @param {boolean} isNew 
 */
export function openModal(task, projectId, columnName, isNew = false) {
  activeTask = task;
  activeProjectId = projectId;
  activeColumnName = columnName;
  isCreatingNew = isNew;
  
  const modalOverlay = document.getElementById('task-modal');
  if (!modalOverlay) return;
  
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  
  // Set project badge label & color
  const badge = document.getElementById('modal-project-badge');
  badge.textContent = project.label;
  badge.style.backgroundColor = getProjectColor(projectId);
  badge.style.color = '#fff';
  
  const modalHeading = document.getElementById('modal-title-heading');
  modalHeading.textContent = isNew ? 'Create New Task' : 'Edit Task';
  
  const titleInput = document.getElementById('task-title-input');
  titleInput.value = task.title.replace(/#[\w-]+/g, '').trim();
  
  const descInput = document.getElementById('task-description-input');
  descInput.value = task.description ? task.description.join('\n') : '';
  
  const tagsInput = document.getElementById('task-tags-input');
  tagsInput.value = task.tags ? task.tags.join(' ') : '';

  const localOnlyInput = document.getElementById('task-local-only-input');
  localOnlyInput.checked = !!task.localOnly;

  const sublist = document.getElementById('subtasks-list');
  sublist.innerHTML = '';
  
  if (task.subtasks && task.subtasks.length > 0) {
    task.subtasks.forEach(sub => {
      sublist.appendChild(createSubtaskRow(sub.title, sub.completed, sub.listType, sub.hasCheckbox, sub.indent, sub.bulletChar));
    });
  }
  
  const deleteBtn = document.getElementById('delete-task-btn');
  deleteBtn.textContent = isNew ? 'Cancel Creation' : 'Delete Task';
  
  modalOverlay.classList.add('open');
  titleInput.focus();
}
