# How to add or modify a settings tab

`SettingsPanel` (`src/features/settings/SettingsPanel.tsx`) is a tabbed modal. Each tab controls one category of local preferences. This guide covers adding a new tab and changing an existing one.

## Architecture

```
SettingsPanel (modal container, tab state)
  ├── Tab bar (role="tablist")
  │     ├── Tab button: Color themes
  │     ├── Tab button: Backend connection
  │     └── Tab button: Shortcuts
  └── Tab panels (role="tabpanel", one visible at a time)
        ├── ThemeSettings (section component)
        ├── BackendSettings (section component)
        └── ShortcutsSettings (section component)
```

`App.tsx` owns all persisted values and passes them into `SettingsPanel` through props. Section components receive only the values and callbacks they need; transient state (theme name being edited, shortcut being captured) lives in `SettingsPanel`.

## Current tabs

| Tab ID | Label | Component | Props from `SettingsPanelProps` |
|---|---|---|---|
| `themes` | Color themes | `ThemeSettings` | `themes`, `activeThemeId`, `onSelectTheme`, `onDuplicateTheme`, `onRenameTheme`, `onUpdateThemeColor`, `onDeleteTheme`, `onResetTheme` |
| `backend` | Backend connection | `BackendSettings` | `backendBaseUrl`, `onBackendBaseUrlChange`, `onBackendBaseUrlReset` |
| `shortcuts` | Shortcuts | `ShortcutsSettings` | `definitions`, `shortcuts`, `onChange`, `onReset` |

## Add a new tab

### Step 1: Extend the tab ID type

Open `src/features/settings/SettingsPanel.tsx` and add your tab ID to the `SettingsTabId` union:

```ts
export type SettingsTabId = 'themes' | 'backend' | 'shortcuts' | 'my-feature'
```

### Step 2: Add the tab to the registry

Add an entry to the `settingsTabs` array in the same file:

```ts
export const settingsTabs: SettingsTabDefinition[] = [
  { id: 'themes', label: 'Color themes' },
  { id: 'backend', label: 'Backend connection' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'my-feature', label: 'My Feature' },
]
```

### Step 3: Add props if the tab needs new values

If your tab needs values or callbacks that `SettingsPanel` doesn't already receive, extend `SettingsPanelProps`:

```ts
interface SettingsPanelProps {
  // ... existing props ...
  myFeatureValue: string
  onMyFeatureChange: (value: string) => void
}
```

Then pass them through in `App.tsx` where `SettingsPanel` is rendered (search for `<SettingsPanel` in `src/App.tsx`).

### Step 4: Write the section component

Create a local component inside `SettingsPanel.tsx`. It receives a typed props interface with only the values it needs:

```tsx
interface MyFeatureSettingsProps {
  myFeatureValue: string
  onMyFeatureChange: (value: string) => void
}

function MyFeatureSettings({ myFeatureValue, onMyFeatureChange }: MyFeatureSettingsProps) {
  return <section>
    <h3>My Feature</h3>
    <label>
      <span>Setting label</span>
      <input onChange={(e) => onMyFeatureChange(e.target.value)} value={myFeatureValue} />
    </label>
  </section>
}
```

Wrap the content in a `<section>` to reuse existing settings spacing.

### Step 5: Render the tab panel

Add a conditional branch inside the `.settings-content` section, after the existing tabs:

```tsx
{activeTab === 'my-feature' && <TabPanel id="settings-tab-my-feature" labelledBy="settings-tab-btn-my-feature">
  <MyFeatureSettings myFeatureValue={myFeatureValue} onMyFeatureChange={onMyFeatureChange} />
</TabPanel>}
```

The `TabPanel` component handles `role="tabpanel"`, `aria-labelledby`, and the `id` that the tab button references with `aria-controls`. The IDs follow the convention `settings-tab-<tab-id>` for the panel and `settings-tab-btn-<tab-id>` for the button.

### Step 6: Persist the value (if needed)

Settings values live in `localStorage` under the `pi-livecraft.` prefix. Add a line to your `App.tsx` callback:

```ts
onMyFeatureChange={(value) => {
  setMyFeature(value)
  window.localStorage.setItem('pi-livecraft.my-feature', value)
}}
```

When reading the value at startup, tolerate missing or malformed data so a bad preference cannot prevent startup.

### Step 7: Validate

- Run `npm run typecheck`.
- Open the settings modal and confirm the new tab appears and displays its content.
- Confirm switching tabs preserves unsaved edits in other tabs (theme name, shortcut capture).
- Run `npm run lint`.

## Modify an existing tab

1. Locate its section component in `SettingsPanel.tsx` (e.g. `ThemeSettings` for the themes tab).
2. Change the component's JSX. If you need new props, add them to the component's interface and to `SettingsPanelProps`, then pass them from `App.tsx`.
3. If you rename or reorder tabs, update the `settingsTabs` array.
4. Run `npm run typecheck` and `npm run lint`.

## Constraints

- Never store secrets in `localStorage`.
- The `open-palette` and `open-settings` shortcut entries must remain excluded from the editable list so both shortcuts always work.
- The footer's **Reset shortcuts** button and **Done** button must stay present.
- The backdrop click and close button must continue to dismiss the modal.
- A tab change must not write any preference to `localStorage` — only an explicit user action (typing, clicking, selecting) should persist.
