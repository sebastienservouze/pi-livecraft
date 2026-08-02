import assert from 'node:assert/strict'
import test from 'node:test'
import { directoryCompletionTarget } from '../src/features/workspace/directory-completion.ts'

test('détermine le dossier et le préfixe à compléter', () => {
  assert.deepEqual(directoryCompletionTarget('~/pro'), {
    parentPath: '~',
    pathPrefix: '~/',
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

test('prend en charge les lecteurs et partages Windows', () => {
  assert.deepEqual(directoryCompletionTarget('C:\\Users\\ali'), {
    parentPath: 'C:\\Users',
    pathPrefix: 'C:\\Users\\',
    namePrefix: 'ali',
  })
  assert.deepEqual(directoryCompletionTarget('C:/Users/'), {
    parentPath: 'C:/Users',
    pathPrefix: 'C:/Users/',
    namePrefix: '',
  })
  assert.deepEqual(directoryCompletionTarget('C:\\pro'), {
    parentPath: 'C:\\',
    pathPrefix: 'C:\\',
    namePrefix: 'pro',
  })
  assert.deepEqual(directoryCompletionTarget('~\\pro'), {
    parentPath: '~',
    pathPrefix: '~\\',
    namePrefix: 'pro',
  })
  assert.deepEqual(directoryCompletionTarget('\\\\server\\share\\pro'), {
    parentPath: '\\\\server\\share',
    pathPrefix: '\\\\server\\share\\',
    namePrefix: 'pro',
  })
  assert.equal(directoryCompletionTarget('C:relative'), null)
  assert.equal(directoryCompletionTarget('\\\\server'), null)
})
