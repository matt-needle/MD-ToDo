/**
 * Markdown Parser and Compiler for Kanban Board
 */

/**
 * Parses a markdown string into a structured ProjectData object.
 * @param {string} text - The markdown content.
 * @param {string} fileName - The source filename (used as default project title).
 * @returns {object} The parsed project data.
 */
export function parseMarkdown(text, fileName = 'Untitled') {
  const lines = text.split(/\r?\n/);
  const columns = [];
  const preamble = [];
  const postamble = [];

  let currentColumn = null;
  let currentTask = null;

  const headingRegex = /^(#{1,6})\s+(.*)$/;

  function matchTaskLine(line) {
    let m;
    // Bullet with checkbox: - [ ] or * [ ]
    m = line.match(/^(\s*)([-*])\s+\[([ xX])\]\s+(.*)$/);
    if (m) return { indent: m[1], listType: 'bullet', bulletChar: m[2], hasCheckbox: true, completed: m[3].toLowerCase() === 'x', title: m[4] };
    // Numeric with checkbox: 1. [ ]
    m = line.match(/^(\s*)(\d+)\.\s+\[([ xX])\]\s+(.*)$/);
    if (m) return { indent: m[1], listType: 'numeric', hasCheckbox: true, completed: m[3].toLowerCase() === 'x', title: m[4] };
    // Alpha-lower with checkbox: a. [ ]
    m = line.match(/^(\s*)([a-z])\.\s+\[([ xX])\]\s+(.*)$/);
    if (m) return { indent: m[1], listType: 'alpha-lower', hasCheckbox: true, completed: m[3].toLowerCase() === 'x', title: m[4] };
    // Alpha-upper with checkbox: A. [ ]
    m = line.match(/^(\s*)([A-Z])\.\s+\[([ xX])\]\s+(.*)$/);
    if (m) return { indent: m[1], listType: 'alpha-upper', hasCheckbox: true, completed: m[3].toLowerCase() === 'x', title: m[4] };
    // Numeric without checkbox: 1. Task
    m = line.match(/^(\s*)(\d+)\.\s+(?!\[)(.+)$/);
    if (m) return { indent: m[1], listType: 'numeric', hasCheckbox: false, completed: false, title: m[3] };
    // Alpha-lower without checkbox: a. Task
    m = line.match(/^(\s*)([a-z])\.\s+(?!\[)(.+)$/);
    if (m) return { indent: m[1], listType: 'alpha-lower', hasCheckbox: false, completed: false, title: m[3] };
    // Alpha-upper without checkbox: A. Task
    m = line.match(/^(\s*)([A-Z])\.\s+(?!\[)(.+)$/);
    if (m) return { indent: m[1], listType: 'alpha-upper', hasCheckbox: false, completed: false, title: m[3] };
    return null;
  }

  // Check if there are any headings in the file
  const hasHeadings = lines.some(line => headingRegex.test(line));

  // Check if we have level 2 (or lower) headings in the file
  const hasLevel2Headings = lines.some(line => {
    const m = line.match(headingRegex);
    return m && m[1].length >= 2;
  });

  function createTaskObject(rawTitle, completed, indentLevel, listType = 'bullet', hasCheckbox = true, bulletChar = '-') {
    let title = rawTitle.trim();
    let inlineDescription = '';
    let hadBoldTitle = false;

    // Check for bold title format: **Title** description
    const boldMatch = title.match(/^\*\*(.*?)\*\*(.*)$/);
    if (boldMatch) {
      title = boldMatch[1].trim();
      inlineDescription = boldMatch[2].trim();
      hadBoldTitle = true;
    }

    // Extract tags: #tag-name
    const tags = [];
    const tagRegex = /#([\w-]+)/g;
    let match;
    while ((match = tagRegex.exec(rawTitle)) !== null) {
      tags.push('#' + match[1]);
    }

    const description = [];
    if (inlineDescription) {
      description.push(inlineDescription);
    }

    return {
      id: Math.random().toString(36).substring(2, 9),
      title,
      completed,
      description,
      subtasks: [],
      tags,
      indentLevel,
      hadBoldTitle,
      listType,
      hasCheckbox,
      bulletChar
    };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === '') {
      if (currentTask) {
        currentTask.description.push('');
      } else if (currentColumn) {
        // ignored
      } else {
        preamble.push(line);
      }
      continue;
    }

    const headingMatch = line.match(headingRegex);
    const taskInfo = matchTaskLine(line);
    const isIndented = /^\s+/.test(line);

    // Non-indented, non-heading, non-task line ends the current task context
    if (currentTask && !isIndented && !headingMatch && !taskInfo) {
      while (currentTask.description.length > 0 && currentTask.description[currentTask.description.length - 1] === '') {
        currentTask.description.pop();
        postamble.push('');
      }
      currentTask = null;
    }

    if (headingMatch) {
      if (currentTask) {
        while (currentTask.description.length > 0 && currentTask.description[currentTask.description.length - 1] === '') {
          currentTask.description.pop();
          postamble.push('');
        }
        currentTask = null;
      }

      const level = headingMatch[1].length;
      const name = headingMatch[2].trim();

      if (level === 1 && hasLevel2Headings && columns.length === 0) {
        preamble.push(line);
        continue;
      }

      currentColumn = { name, level, tasks: [] };
      columns.push(currentColumn);
      currentTask = null;
      continue;
    }

    if (taskInfo) {
      const indent = taskInfo.indent.length;
      const { completed, title, listType, hasCheckbox, bulletChar = '-' } = taskInfo;

      if (currentTask && indent > currentTask.indentLevel) {
        currentTask.subtasks.push({
          title: title.trim(),
          completed,
          listType,
          hasCheckbox,
          bulletChar,
          indent: taskInfo.indent
        });
      } else {
        currentTask = createTaskObject(title, completed, indent, listType, hasCheckbox, bulletChar);

        if (currentColumn) {
          currentColumn.tasks.push(currentTask);
        } else if (!hasHeadings) {
          const defaultColName = completed ? 'Done' : 'Todo';
          let col = columns.find(c => c.name === defaultColName);
          if (!col) {
            col = { name: defaultColName, level: 2, tasks: [] };
            columns.push(col);
          }
          col.tasks.push(currentTask);
        } else {
          let backlogCol = columns.find(c => c.name === 'Backlog');
          if (!backlogCol) {
            backlogCol = { name: 'Backlog', level: 2, tasks: [] };
            columns.unshift(backlogCol);
          }
          backlogCol.tasks.push(currentTask);
        }
      }
      continue;
    }

    // Indented description line
    if (currentTask && (line.match(/^\s+/) || currentTask.description.length > 0)) {
      const spacesToTrim = currentTask.indentLevel + 2;
      const trimmed = line.startsWith(' '.repeat(spacesToTrim))
        ? line.substring(spacesToTrim)
        : line.trim();
      currentTask.description.push(trimmed);
      continue;
    }

    if (columns.length === 0) {
      preamble.push(line);
    } else {
      postamble.push(line);
    }
  }

  // Cleanup descriptions: remove trailing empty lines
  columns.forEach(col => {
    col.tasks.forEach(task => {
      while (task.description.length > 0 && task.description[task.description.length - 1] === '') {
        task.description.pop();
      }
    });
  });

  const title = fileName.replace(/\.[^/.]+$/, '')
                        .replace(/[_-]/g, ' ')
                        .replace(/\b\w/g, c => c.toUpperCase());

  return {
    title,
    preamble: preamble.filter(l => l.trim() !== '' || preamble.indexOf(l) < preamble.length - 1),
    columns,
    postamble: postamble.filter(l => l.trim() !== ''),
    hasHeadings
  };
}

/**
 * Compiles a ProjectData object back into a markdown string,
 * preserving the original list format (bullet / numeric / alpha).
 * @param {object} data - The project data.
 * @returns {string} The markdown content.
 */
export function compileMarkdown(data) {
  const lines = [];

  function getMarker(listType, index, bulletChar) {
    if (listType === 'numeric') return `${index + 1}.`;
    if (listType === 'alpha-lower') return `${String.fromCharCode(97 + index)}.`;
    if (listType === 'alpha-upper') return `${String.fromCharCode(65 + index)}.`;
    return bulletChar || '-';
  }

  function taskLine(indentStr, marker, hasCheckbox, completed, title) {
    const checkbox = (hasCheckbox || completed) ? `[${completed ? 'x' : ' '}] ` : '';
    return `${indentStr}${marker} ${checkbox}${title}`;
  }

  function writeTask(task, taskIdx) {
    const listType = task.listType || 'bullet';
    const marker = getMarker(listType, taskIdx, task.bulletChar);
    const useBold = task.hadBoldTitle;

    if (useBold) {
      const firstDesc = (task.description && task.description.length > 0) ? ' ' + task.description[0] : '';
      const checkbox = (task.hasCheckbox || task.completed) ? `[${task.completed ? 'x' : ' '}] ` : '';
      lines.push(`${marker} ${checkbox}**${task.title}**${firstDesc}`);
      if (task.description && task.description.length > 1) {
        task.description.slice(1).forEach(descLine => lines.push(`  ${descLine}`));
      }
    } else {
      lines.push(taskLine('', marker, task.hasCheckbox ?? true, task.completed, task.title));
      if (task.description && task.description.length > 0) {
        task.description.forEach(descLine => lines.push(descLine ? `  ${descLine}` : ''));
      }
    }

    if (task.subtasks && task.subtasks.length > 0) {
      task.subtasks.forEach((sub, subIdx) => {
        const subListType = sub.listType || 'bullet';
        const subMarker = getMarker(subListType, subIdx, sub.bulletChar);
        const subIndent = sub.indent || '  ';
        lines.push(taskLine(subIndent, subMarker, sub.hasCheckbox ?? true, sub.completed, sub.title));
      });
    }
  }

  // 1. Preamble
  if (data.preamble && data.preamble.length > 0) {
    lines.push(...data.preamble);
    if (data.columns.length > 0) lines.push('');
  }

  const hasHeadings = data.hasHeadings || data.columns.length > 2 || (data.columns.length > 0 && !['Todo', 'Done'].includes(data.columns[0].name));

  if (hasHeadings) {
    data.columns.forEach((col, colIdx) => {
      lines.push(`${'#'.repeat(col.level || 2)} ${col.name}`);
      col.tasks.forEach((task, taskIdx) => writeTask(task, taskIdx));
      if (colIdx < data.columns.length - 1 || (data.postamble && data.postamble.length > 0)) {
        lines.push('');
      }
    });
  } else {
    data.columns.forEach(col => {
      col.tasks.forEach((task, taskIdx) => writeTask(task, taskIdx));
    });
  }

  // 3. Postamble
  if (data.postamble && data.postamble.length > 0) {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
    lines.push(...data.postamble);
  }

  return lines.join('\n').trim() + '\n';
}
