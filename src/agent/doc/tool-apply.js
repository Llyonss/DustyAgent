const fs = require('fs');
const path = require('path');

function normalizeEndings(s) {
  return s.replace(/\r\n/g, '\n');
}

module.exports = function(docPath) {
  return [
    {
      name: 'apply',
      description: `Full rewrite of the document. Provide "content" with the complete new document.
Use only when creating the document for the first time or rewriting most of it.
After writing, call commit to record the version.`,
      input_schema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Complete new document content' },
        },
        required: ['content'],
      },
      execute: async (input) => {
        fs.mkdirSync(path.dirname(docPath), { recursive: true });
        fs.writeFileSync(docPath, input.content);
        return 'Document written (full rewrite). Call commit when done.';
      },
    },
    {
      name: 'patch',
      description: `Incremental edit of the document. Provide "old" (exact substring) and "new" (replacement).
"old" must be an EXACT substring of the current document (copy-paste precision).
The patch will FAIL if "old" matches more than one location. Provide more context to make it unique.
After patching, call commit to record the version.`,
      input_schema: {
        type: 'object',
        properties: {
          old: { type: 'string', description: 'Exact substring to find in current document' },
          new: { type: 'string', description: 'Replacement text' },
        },
        required: ['old', 'new'],
      },
      execute: async (input) => {
        let raw;
        try {
          raw = fs.readFileSync(docPath, 'utf-8');
        } catch (e) {
          throw new Error('cannot read document for patching: ' + e.message);
        }
        const useCRLF = raw.includes('\r\n');
        let doc = normalizeEndings(raw);
        const old = normalizeEndings(input.old);
        const replacement = normalizeEndings(input.new);

        if (!doc.includes(old)) {
          const snippet = old.length > 200 ? old.substring(0, 200) + '...' : old;
          throw new Error('text not found in document: "' + snippet + '"');
        }
        const matches = doc.split(old).length - 1;
        if (matches > 1) {
          const snippet = old.length > 200 ? old.substring(0, 200) + '...' : old;
          throw new Error('found ' + matches + ' matches in document. Provide more context to uniquely identify the target: "' + snippet + '"');
        }
        doc = doc.replace(old, replacement);
        if (useCRLF) doc = doc.replace(/\n/g, '\r\n');
        fs.writeFileSync(docPath, doc);
        return 'Document patched. Call commit when done.';
      },
    },
    {
      name: 'commit',
      description: `Commit the current document version. Provide "summary" describing what changed in this version.
This stops the current loop. The summary will appear in version history.
Call this after you have finished all apply/patch operations for this version.`,
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Brief summary of changes in this version' },
        },
        required: ['summary'],
      },
      execute: async (input, ctrl) => {
        ctrl.stop();
        return 'Version committed: ' + input.summary;
      },
    },
  ];
};
