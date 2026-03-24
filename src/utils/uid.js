let _counter = 0;
export function uid(prefix = 'id') {
  return `${prefix}-${Date.now()}-${(++_counter).toString(36)}`;
}
