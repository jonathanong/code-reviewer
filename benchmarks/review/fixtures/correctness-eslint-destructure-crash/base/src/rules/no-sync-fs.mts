export const noSyncFs = {
  meta: { type: 'problem', messages: { sync: 'Use the async fs call.' }, schema: [] },
  create(context: any) {
    return {
      CallExpression(node: any) {
        if (node.callee.type === 'Identifier' && node.callee.name.endsWith('Sync')) {
          context.report({ node, messageId: 'sync' })
        }
      },
    }
  },
}
