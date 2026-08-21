import { dateTimeInputValue, dateTimeMilliseconds, emptyQueryExtras } from './query';
import type { FieldFilter, FieldOperator, QueryExtras } from './types';

const operators: Array<[FieldOperator, string]> = [
  ['equals', '='], ['notEquals', '≠'], ['contains', 'contains'], ['notContains', 'not contains'],
  ['greater', '>'], ['greaterOrEqual', '≥'], ['less', '<'], ['lessOrEqual', '≤'],
  ['exists', 'exists'], ['notExists', 'missing'],
];
const valueLessOperators = new Set<FieldOperator>(['exists', 'notExists']);
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

export type FilterPanel = {
  snapshot(): QueryExtras;
  clear(notify?: boolean): void;
  setInvalidOnly(enabled: boolean): void;
  addField(path: string, value: string, operator?: FieldOperator): void;
};

export function createFilterPanel(onApply: () => void, onError: (message: string) => void): FilterPanel {
  let current = emptyQueryExtras();
  const dialog = $<HTMLDialogElement>('#filterDialog');
  const rows = $('#fieldFilterRows');

  const clone = (value: QueryExtras): QueryExtras => ({ ...value, fieldFilters: value.fieldFilters.map(filter => ({ ...filter })) });

  function updateSummary() {
    const count = current.fieldFilters.length + Number(current.timeStartMs !== null || current.timeEndMs !== null) + Number(current.context > 0) + Number(current.invalidOnly);
    $('#filterCount').textContent = count ? String(count) : '';
    $('#filters').classList.toggle('active', count > 0);
  }

  function createRow(filter: FieldFilter = { path: '', operator: 'equals', value: '' }) {
    const row = document.createElement('div');
    row.className = 'field-filter-row';

    const path = document.createElement('input');
    path.className = 'filter-path';
    path.placeholder = 'field.path';
    path.value = filter.path;

    const operator = document.createElement('select');
    operator.className = 'filter-operator';
    for (const [value, label] of operators) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = value === filter.operator;
      operator.append(option);
    }

    const value = document.createElement('input');
    value.className = 'filter-value';
    value.placeholder = 'value';
    value.value = filter.value;
    const syncValue = () => { value.disabled = valueLessOperators.has(operator.value as FieldOperator); };
    operator.onchange = syncValue;
    syncValue();

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'filter-remove';
    remove.title = 'Remove filter';
    remove.textContent = '×';
    remove.onclick = () => row.remove();
    row.append(path, operator, value, remove);
    rows.append(row);
    return row;
  }

  function populate(value: QueryExtras) {
    rows.replaceChildren();
    value.fieldFilters.forEach(createRow);
    $<HTMLInputElement>('#timeStart').value = dateTimeInputValue(value.timeStartMs);
    $<HTMLInputElement>('#timeEnd').value = dateTimeInputValue(value.timeEndMs);
    $<HTMLInputElement>('#contextLines').value = String(value.context);
    $<HTMLInputElement>('#invalidOnly').checked = value.invalidOnly;
  }

  function open() {
    populate(current);
    dialog.showModal();
  }

  function read(): QueryExtras | null {
    const fieldFilters = [...rows.querySelectorAll<HTMLElement>('.field-filter-row')].map(row => ({
      path: row.querySelector<HTMLInputElement>('.filter-path')!.value.trim(),
      operator: row.querySelector<HTMLSelectElement>('.filter-operator')!.value as FieldOperator,
      value: row.querySelector<HTMLInputElement>('.filter-value')!.value,
    })).filter(filter => filter.path);
    const timeStartMs = dateTimeMilliseconds($<HTMLInputElement>('#timeStart').value);
    const endValue = $<HTMLInputElement>('#timeEnd').value;
    const parsedEnd = dateTimeMilliseconds(endValue);
    const timeEndMs = parsedEnd === null ? null : parsedEnd + (endValue.length <= 19 ? 999 : 0);
    if (timeStartMs !== null && timeEndMs !== null && timeStartMs > timeEndMs) {
      onError('Start time must not be later than end time');
      return null;
    }
    return {
      fieldFilters,
      timeStartMs,
      timeEndMs,
      context: Math.max(0, Math.min(100, Number($<HTMLInputElement>('#contextLines').value) || 0)),
      invalidOnly: $<HTMLInputElement>('#invalidOnly').checked,
    };
  }

  $('#filters').onclick = open;
  $('#filterClose').onclick = () => dialog.close();
  $('#addFieldFilter').onclick = () => createRow().querySelector<HTMLInputElement>('.filter-path')!.focus();
  $('#resetFilters').onclick = () => populate(emptyQueryExtras());
  $('#applyFilters').onclick = () => {
    const next = read();
    if (!next) return;
    current = next;
    updateSummary();
    dialog.close();
    onApply();
  };

  updateSummary();
  return {
    snapshot: () => clone(current),
    clear(notify = true) {
      current = emptyQueryExtras();
      updateSummary();
      if (notify) onApply();
    },
    setInvalidOnly(enabled: boolean) {
      current.invalidOnly = enabled;
      updateSummary();
      onApply();
    },
    addField(path: string, value: string, operator: FieldOperator = 'equals') {
      populate(current);
      createRow({ path, operator, value });
      dialog.showModal();
    },
  };
}

export function filterInputValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
