import assert from 'node:assert/strict'
import test from 'node:test'
import { directoryCompletionTarget } from '../src/features/workspace/directory-completion.ts'

test('determines POSIX and home directory completion targets', () => {
  assert.deepEqual(directoryCompletionTarget('~/pro'), {
    parentPath: '~',
    pathPrefix: '~/',
    namePrefix: 'pro',
  })
  assert.deepEqual(directoryCompletionTarget('~\\pro'), {
    parentPath: '~',
    pathPrefix: '~\\',
    namePrefix: 'pro',
  })
  assert.deepEqual(directoryCompletionTarget('/home/user/'), {
    parentPath: '/home/user',
    pathPrefix: '/home/user/',
    namePrefix: '',
  })
  assert.deepEqual(directoryCompletionTarget('/.co'), {
    parentPath: '/',
    pathPrefix: '/',
    namePrefix: '.co',
  })
  assert.equal(directoryCompletionTarget('relative/path'), null)
})

test('completes drive and UNC paths while preserving the typed separator', () => {
  assert.deepEqual(directoryCompletionTarget('C:\\Users\\Ada\\pro'), {
    parentPath: 'C:\\Users\\Ada',
    pathPrefix: 'C:\\Users\\Ada\\',
    namePrefix: 'pro',
  })
  assert.deepEqual(directoryCompletionTarget('C:\\'), {
    parentPath: 'C:\\',
    pathPrefix: 'C:\\',
    namePrefix: '',
  })
  assert.deepEqual(directoryCompletionTarget('D:/'), {
    parentPath: 'D:/',
    pathPrefix: 'D:/',
    namePrefix: '',
  })
  assert.deepEqual(directoryCompletionTarget('\\\\server\\share\\nested\\pro'), {
    parentPath: '\\\\server\\share\\nested',
    pathPrefix: '\\\\server\\share\\nested\\',
    namePrefix: 'pro',
  })
  assert.deepEqual(directoryCompletionTarget('\\\\server/share\\nested/pro'), {
    parentPath: '\\\\server/share\\nested',
    pathPrefix: '\\\\server/share\\nested/',
    namePrefix: 'pro',
  })
  assert.deepEqual(directoryCompletionTarget('\\\\server\\share\\'), {
    parentPath: '\\\\server\\share',
    pathPrefix: '\\\\server\\share\\',
    namePrefix: '',
  })
  assert.equal(directoryCompletionTarget('C:relative'), null)
})
