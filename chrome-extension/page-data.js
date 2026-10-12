// Runs in the page's MAIN world. Reads only comment component props, never handlers or global stores.
(() => {
  const get = (object, key) => {
    if (!object || typeof object !== 'object') return undefined;
    try { return Object.getOwnPropertyDescriptor(object, key)?.value; } catch (_) { return undefined; }
  };
  const id = value => (typeof value === 'number' && Number.isSafeInteger(value) || typeof value === 'string') && /^-?[1-9]\d*$/.test(String(value)) ? String(value) : '';
  const positive = value => /^[1-9]\d*$/.test(id(value)) ? id(value) : '';
  const firstId = (object, keys) => keys.map(key => id(get(object, key))).find(Boolean) || '';
  const result = {comments: [], inspected: 0, matched: 0, schemas: []};
  const schemas = new Set();
  for (const card of document.querySelectorAll('[data-testid="comment"]')) {
    const commentId = positive(card.id);
    if (!commentId) continue;
    result.inspected++;
    const found = new Map();
    const seen = new Set();
    const add = (key, value) => {
      if (value === undefined || value === '') return;
      if (!found.has(key)) found.set(key, new Set());
      found.get(key).add(value);
    };
    const read = (model, context) => {
      const modelId = firstId(model, ['commentId', 'comment_id', 'id']);
      if (modelId !== commentId) return;
      const keys = Object.keys(model).filter(key => /^(?:id|comment_?id|author.*|from.*|user.*|owner.*|reply.*|parent.*|text|thread.*)$/i.test(key)).slice(0,30);
      const schema = keys.sort().join(',');
      if (schema && !schemas.has(schema) && result.schemas.length < 12) { schemas.add(schema); result.schemas.push(keys); }
      let authorId = firstId(model, ['from_id', 'fromId', 'author_id', 'authorId', 'user_id', 'userId']);
      for (const source of [model, context]) {
        for (const key of ['author', 'user', 'profile']) {
          const author = get(source, key);
          const value = firstId(author, ['id', 'user_id', 'userId']);
          if (value) { if (!authorId) authorId = value; else if (authorId !== value) add('user_id', value); }
        }
      }
      add('user_id', authorId);
      for (const key of ['reply_to_comment', 'replyToComment', 'replyToCommentId', 'parent_comment_id', 'parentCommentId', 'parentId']) {
        let value = get(model, key);
        if (value && typeof value === 'object') value = get(value, 'id');
        if (positive(value) && String(value) !== commentId) { add('parent_comment_id', String(value)); add('is_reply', true); }
        else if (value === 0 || value === '0') add('is_reply', false);
      }
      const stack = get(model, 'parents_stack') || get(model, 'parentsStack');
      if (Array.isArray(stack) && stack.length && positive(stack[stack.length-1])) {
        add('parent_comment_id', String(stack[stack.length-1])); add('is_reply', true);
      }
    };
    const inspect = (object, context, depth = 0) => {
      if (!object || typeof object !== 'object' || seen.has(object) || seen.size >= 160) return;
      seen.add(object); read(object, context);
      if (depth >= 3) return;
      for (const key of ['comment', 'reply', 'item', 'data']) inspect(get(object, key), object, depth + 1);
    };
    // React keeps props on host elements and on their component ancestors.
    for (const node of [card, ...card.querySelectorAll('[data-testid="comment-owner"], [data-testid="comment-reply-parent"]')].filter(node => node === card || node.closest('[data-testid="comment"]') === card)) {
      for (const key of Object.keys(node)) {
        if (key.startsWith('__reactProps$')) inspect(get(node, key), null);
        if (!key.startsWith('__reactFiber$')) continue;
        let fiber = get(node, key);
        for (let depth = 0; fiber && depth < 14; depth++, fiber = get(fiber, 'return')) inspect(get(fiber, 'memoizedProps'), null);
      }
    }
    const record = {comment_id: commentId};
    for (const [key, values] of found) if (values.size === 1) record[key] = [...values][0];
    if (record.parent_comment_id) record.is_reply = true;
    if (record.user_id) record.author_profile_url = `https://vk.com/${record.user_id.startsWith('-') ? 'club' + record.user_id.slice(1) : 'id' + record.user_id}`;
    if (Object.keys(record).length > 1) { result.comments.push(record); result.matched++; }
  }
  return result;
})();
