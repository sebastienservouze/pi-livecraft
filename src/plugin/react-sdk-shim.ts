/** Re-exports the Hermes dashboard host React instance for aliased `react` imports. */
import * as DevReact from 'react'

declare global {
  interface Window {
    __HERMES_PLUGIN_SDK__?: { React: typeof DevReact }
  }
}

function resolveReact(): typeof DevReact {
  if (typeof window !== 'undefined' && window.__HERMES_PLUGIN_SDK__?.React) {
    return window.__HERMES_PLUGIN_SDK__.React
  }
  return DevReact
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
