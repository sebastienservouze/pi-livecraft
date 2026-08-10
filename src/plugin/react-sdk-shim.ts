/** Re-exports the Hermes dashboard host React instance for aliased `react` imports. */
type ReactNamespace = typeof import('react')

declare global {
  interface Window {
    __HERMES_PLUGIN_SDK__?: { React: ReactNamespace }
  }
}

function resolveReact(): ReactNamespace {
  const hostReact = typeof window !== 'undefined'
    ? window.__HERMES_PLUGIN_SDK__?.React
    : undefined
  if (!hostReact) {
    throw new Error('Hermes plugin SDK React is unavailable')
  }
  return hostReact
}

const React = resolveReact()

export default React

export const {
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} = React

export type {
  CSSProperties,
  ComponentProps,
  ComponentPropsWithoutRef,
  ComponentPropsWithRef,
  ComponentType,
  FC,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  ReactElement,
  ReactNode,
  RefObject,
  SyntheticEvent,
} from 'react'
