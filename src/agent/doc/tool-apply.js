const fs = require('fs');
const path = require('path');

module.exports = function(docPath) {
  return {
    name: 'apply',
    description: `Update the document. Two modes (provide ONE of content or edits, not both):

1. Full rewrite — provide "content" with the complete new document.
   Use only when creating the document for the first time or rewriting most of it.

2. Incremental edit — provide "edits" with an array of {old, new} replacements.
   Use for most updates. "old" must be an EXACT substring of the current document (copy-paste precision). Each replacement is applied in order.
   Prefer this mode — it is faster, cheaper, and less error-prone.

Always provide "summary" describing what changed.`,
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Brief summary of changes' },
        content: { type: 'string', description: 'Complete new document content (full rewrite mode)' },
        edits: {
          type: 'array',
          description: 'Array of replacements (incremental edit mode)',
          items: {
            type: 'object',
            properties: {
              old: { type: 'string', description: 'Exact substring to find in current document' },
              new: { type: 'string', description: 'Replacement text' },
            },
            required: ['old', 'new'],
          },
        },
      },
      required: ['summary'],
    },
    execute: async (input, ctrl) => {
      fs.mkdirSync(path.dirname(docPath), { recursive: true });

      if (input.content != null) {
        // Full rewrite mode
        fs.writeFileSync(docPath, input.content);
        ctrl.stop();
        return 'Document updated (full rewrite): ' + input.summary;
      }

      if (input.edits && input.edits.length > 0) {
        // Incremental edit mode
        let doc;
        try {
          doc = fs.readFileSync(docPath, 'utf-8');
        } catch (e) {
          throw new Error('cannot read document for editing: ' + e.message);
        }
        for (const edit of input.edits) {
          if (!doc.includes(edit.old)) {
            const snippet = edit.old.length > 200 ? edit.old.substring(0, 200) + '...' : edit.old;
            throw new Error('text not found in document: "' + snippet + '"');
          }
          const matches = doc.split(edit.old).length - 1;
          if (matches > 1) {
            const snippet = edit.old.length > 200 ? edit.old.substring(0, 200) + '...' : edit.old;
            throw new Error('found ' + matches + ' matches in document. Provide more context to uniquely identify the target: "' + snippet + '"');
          }
          doc = doc.replace(edit.old, edit.new);
        }
        fs.writeFileSync(docPath, doc);
        ctrl.stop();
        return 'Document updated (incremental edit, ' + input.edits.length + ' replacements): ' + input.summary;
      }

      throw new Error('provide either "content" (full rewrite) or "edits" (incremental edit)');
    },
  };
};
