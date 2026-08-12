import assert from 'node:assert/strict'
import test from 'node:test'
import {
  commandDefinitions,
  defaultShortcuts,
  lastAssistantText,
  migrateLegacyShortcut,
  rightWidgetCommandId,
  rightWidgetFromCommand,
  shortcutConflicts,
  shortcutFromEvent,
} from '../src/features/commands/command-registry.ts'
import { rightWidgetDefinitions } from '../src/features/right-sidebar/right-sidebar.ts'

test('conserve exactement les touches d’un raccourci', () => {
  assert.equal(shortcutFromEvent({ key: 'K' }), 'k')
  assert.equal(shortcutFromEvent({ key: 'K', ctrlKey: true }), 'ctrl+k')
  assert.equal(shortcutFromEvent({ key: 'K', metaKey: true, altKey: true }), 'meta+alt+k')
  assert.equal(shortcutFromEvent({ key: 'Control', ctrlKey: true }), '')
  assert.equal(defaultShortcuts['new-session'], 'alt+n')
  assert.equal(defaultShortcuts['open-palette'], 'alt+k')
  assert.equal(defaultShortcuts['open-widget-todo'], 'alt+y')
  assert.equal(defaultShortcuts.send, undefined)
  assert.equal(migrateLegacyShortcut('mod+k', 'meta'), 'meta+k')
})

test('expose automatiquement chaque widget dans le registre de commandes', () => {
  for (const widget of rightWidgetDefinitions) {
    const commandId = rightWidgetCommandId(widget.id)
    assert.equal(rightWidgetFromCommand(commandId), widget.id)
    assert.ok(
      commandDefinitions.some(({ id, label }) =>
        id === commandId && label === `Open ${widget.label}`
      ),
    )
  }
})

test('détecte les conflits de raccourcis', () => {
  const conflicts = shortcutConflicts({ send: 'ctrl+k', abort: 'ctrl+k', 'open-agent': 'meta+k' })
  assert.deepEqual([...conflicts].sort(), ['abort', 'send'])
})

test('les nouvelles commandes de productivité sont reconnues par le registre', () => {
  const ids = [
    'open-directory-picker',
    'workspace-previous',
    'focus-composer',
    'next-session',
    'previous-session',
    'toggle-conversation-view',
  ]
  for (const id of ids) {
    const definition = commandDefinitions.find((d) => d.id === id)
    assert.ok(definition, `Commande ${id} absente du registre`)
    assert.equal(typeof definition.label, 'string')
  }
})

test('les nouveaux raccourcis par défaut sont définis', () => {
  assert.equal(defaultShortcuts['open-directory-picker'], 'alt+d')
  assert.equal(defaultShortcuts['workspace-previous'], 'alt+&')
  assert.equal(defaultShortcuts['focus-composer'], 'alt+2')
  assert.equal(defaultShortcuts['next-session'], 'alt+arrowright')
  assert.equal(defaultShortcuts['previous-session'], 'alt+arrowleft')
  assert.equal(defaultShortcuts['toggle-conversation-view'], undefined)
  assert.equal(defaultShortcuts['open-widget-explorer'], 'alt+o')
  assert.equal(defaultShortcuts['open-widget-shell'], 'alt+t')
})

test('extrait la dernière réponse assistant', () => {
  assert.equal(
    lastAssistantText([{ role: 'assistant', content: 'Première' }, {
      role: 'assistant',
      content: [{ type: 'text', text: 'Dernière' }],
    }]),
    'Dernière',
  )
})
