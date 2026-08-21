import type { FieldOperator } from './types';

export type JsonFilterAction = {
  path: string;
  operator: FieldOperator;
  value: unknown;
};

type FilterHandler = (action: JsonFilterAction) => void;
type MenuAction = [FieldOperator, string];

const commonActions: MenuAction[] = [
  ['equals', 'Equals'], ['notEquals', 'Not equal'], ['exists', 'Exists'], ['notExists', 'Missing'],
];
const stringActions: MenuAction[] = [
  ['equals', 'Equals'], ['notEquals', 'Not equal'], ['contains', 'Contains'], ['notContains', 'Not contains'],
  ['exists', 'Exists'], ['notExists', 'Missing'],
];
const numberActions: MenuAction[] = [
  ['equals', '='], ['notEquals', '≠'], ['greater', '>'], ['greaterOrEqual', '≥'],
  ['less', '<'], ['lessOrEqual', '≤'], ['exists', 'Exists'], ['notExists', 'Missing'],
];
const containerActions: MenuAction[] = [['exists', 'Exists'], ['notExists', 'Missing']];

function actionsFor(value: unknown): MenuAction[] {
  if (typeof value === 'string') return stringActions;
  if (typeof value === 'number') return numberActions;
  if (value !== null && typeof value === 'object') return containerActions;
  return commonActions;
}

function token(text: string, className: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

function appendPrimitive(content: HTMLElement, value: unknown) {
  const serialized = JSON.stringify(value);
  const className = typeof value === 'string' ? 'json-string'
    : typeof value === 'number' ? 'json-number'
      : typeof value === 'boolean' ? 'json-boolean' : 'json-null';
  content.append(token(serialized, className));
}

export function renderJsonViewer(container: HTMLElement, value: unknown, onFilter: FilterHandler): void {
  let activeMenu: HTMLElement | null = null;
  let activeTrigger: HTMLButtonElement | null = null;

  function closeMenu() {
    activeMenu?.remove();
    activeTrigger?.setAttribute('aria-expanded', 'false');
    activeMenu = null;
    activeTrigger = null;
  }

  function openMenu(row: HTMLElement, trigger: HTMLButtonElement, path: string, fieldValue: unknown) {
    if (activeTrigger === trigger) { closeMenu(); return; }
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'json-filter-menu';
    menu.role = 'menu';
    menu.setAttribute('aria-label', `Filter ${path}`);
    for (const [operator, label] of actionsFor(fieldValue)) {
      const action = document.createElement('button');
      action.type = 'button';
      action.role = 'menuitem';
      action.textContent = label;
      action.onclick = event => {
        event.stopPropagation();
        closeMenu();
        onFilter({ path, operator, value: fieldValue });
      };
      menu.append(action);
    }
    row.append(menu);
    trigger.setAttribute('aria-expanded', 'true');
    activeMenu = menu;
    activeTrigger = trigger;
  }

  function createRow(depth: number, path: string | null, fieldValue: unknown): [HTMLElement, HTMLElement] {
    const row = document.createElement('div');
    row.className = 'json-node';
    row.style.setProperty('--json-depth', String(depth));
    const content = document.createElement('div');
    content.className = 'json-line-content';
    row.append(content);
    if (path) {
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'json-filter-trigger';
      trigger.title = `Filter by ${path}`;
      trigger.setAttribute('aria-label', `Filter by ${path}`);
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12L9.5 8v4L6.5 14V8L2 3Z"/></svg>';
      trigger.onclick = event => { event.stopPropagation(); openMenu(row, trigger, path, fieldValue); };
      row.append(trigger);
    }
    container.append(row);
    return [row, content];
  }

  function renderValue(fieldValue: unknown, path: string, depth: number, key: string | null, trailing: boolean) {
    const isArray = Array.isArray(fieldValue);
    const isObject = fieldValue !== null && typeof fieldValue === 'object';
    const entries = isArray ? fieldValue.map((child, index) => [String(index), child] as const)
      : isObject ? Object.entries(fieldValue as Record<string, unknown>) : [];
    const [, content] = createRow(depth, path || null, fieldValue);
    if (key !== null) content.append(token(`${JSON.stringify(key)}: `, 'json-key'));
    if (!isObject) {
      appendPrimitive(content, fieldValue);
      if (trailing) content.append(token(',', 'json-punctuation'));
      return;
    }
    const open = isArray ? '[' : '{';
    const close = isArray ? ']' : '}';
    content.append(token(entries.length ? open : `${open}${close}`, 'json-punctuation'));
    if (!entries.length) {
      if (trailing) content.append(token(',', 'json-punctuation'));
      return;
    }
    entries.forEach(([childKey, child], index) => {
      const childPath = path ? `${path}.${childKey}` : childKey;
      renderValue(child, childPath, depth + 1, isArray ? null : childKey, index < entries.length - 1);
    });
    const [, closing] = createRow(depth, null, fieldValue);
    closing.append(token(`${close}${trailing ? ',' : ''}`, 'json-punctuation'));
  }

  container.replaceChildren();
  container.classList.remove('raw-json');
  container.onclick = event => {
    if (!(event.target as Element).closest('.json-filter-menu,.json-filter-trigger')) closeMenu();
  };
  container.onkeydown = event => {
    if (event.key !== 'Escape' || !activeMenu) return;
    event.stopPropagation();
    const trigger = activeTrigger;
    closeMenu();
    trigger?.focus();
  };
  renderValue(value, '', 0, null, false);
}

export function renderRawJson(container: HTMLElement, raw: string): void {
  container.replaceChildren();
  container.classList.add('raw-json');
  container.onclick = null;
  container.onkeydown = null;
  container.textContent = raw;
}
