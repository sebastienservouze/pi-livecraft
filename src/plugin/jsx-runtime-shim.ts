import React from './react-sdk-shim.ts'

export const Fragment = React.Fragment

type ReactProps = Record<string, unknown> & { children?: unknown }

/** JSX automatic runtime entry used by the bundler for production builds. */
export function jsx(
  type: React.ElementType,
  props: ReactProps,
  key?: string | number,
): React.ReactElement {
  if (key != null) return React.createElement(type, { ...props, key })
  return React.createElement(type, props)
}

/** JSX automatic runtime entry for multiple children. */
export function jsxs(
  type: React.ElementType,
  props: ReactProps,
  key?: string | number,
): React.ReactElement {
  return jsx(type, props, key)
}
