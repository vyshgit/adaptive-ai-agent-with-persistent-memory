import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { MemWalMock } from '@mysten-incubation/memwal'
import { AppError } from '../../server/safety.mjs'
import { suiAddress } from '../../server/agent/wallet-auth.mjs'

// Synthetic account/delegate authorization, with SDK mock storage per account.
// No network, funded keys, genuine embeddings, or Mainnet evidence.
export function memoryAccountsFixture(pairs) {
  const packageId = suiAddress('0xf')
  const accounts = pairs.map((pair, i) => {
    const delegate = Ed25519Keypair.generate()
    return { owner: pair.toSuiAddress(), accountId: suiAddress(`0x${i + 1}`), delegateKey: delegate.getSecretKey(),
      publicKey: Buffer.from(delegate.getPublicKey().toRawBytes()).toString('hex'), tatumKey: `synthetic-tatum-user-${i + 1}`,
      records: new Map(), sdk: MemWalMock.create({ owner: pair.toSuiAddress() }) }
  })
  const calls = [], backends = []
  const dependencies = {
    deployment: async () => ({ packageId, network: 'mainnet' }),
    graphql: async (query, variables, credentials) => {
      if (!accounts.some(account => account.tatumKey === credentials.apiKey)) throw new Error('Unknown synthetic Tatum credential')
      if (query.includes('Checkpoint')) return { checkpoint: { sequenceNumber: '123', digest: 'synthetic-checkpoint' } }
      const account = accounts.find(account => account.accountId === variables.address)
      return { object: account ? { address: account.accountId, version: '1', digest: 'synthetic-account', owner: { __typename: 'Shared' },
        asMoveObject: { contents: { json: { owner: account.owner }, type: { repr: `${packageId}::account::MemWalAccount` } } } } : null }
    },
    backendFactory: ({ env }) => {
      const account = accounts.find(account => account.accountId === env.MEMWAL_ACCOUNT_ID)
      const delegate = accounts.find(account => account.delegateKey === env.MEMWAL_PRIVATE_KEY)
      let destroyed = false
      function active() { if (destroyed) throw new AppError('wallet_required', 'Synthetic client disposed.', 401) }
      function authorize(method, input) {
        active()
        if (!account || delegate !== account) throw new AppError('memory_unauthorized', 'Synthetic delegate cannot access that account.', 403)
        calls.push({ accountId: account.accountId, method, input })
      }
      const sdk = {
        getPublicKeyHex: async () => { active(); return delegate?.publicKey || '' },
        listNamespaces: async input => { authorize('listNamespaces', input); return account.sdk.listNamespaces(input) },
        recall: async input => { authorize('recall', input); return account.sdk.recall(input) },
        rememberBulkAndWait: async (items, options) => { authorize('rememberBulkAndWait', items); return account.sdk.rememberBulkAndWait(items, options) },
        analyzeAndWait: async (text, options, wait) => { authorize('analyzeAndWait', { text, ...options }); return account.sdk.analyzeAndWait(text, options, wait) },
        restore: async (namespace, limit) => { authorize('restore', { namespace, limit }); return account.sdk.restore(namespace, limit) },
      }
      const backend = { env, mode: () => 'relayer', getClient: () => { active(); return sdk },
        status: async () => { active(); return { mode: 'relayer', network: 'mainnet', healthy: true, writeReady: true, accountId: env.MEMWAL_ACCOUNT_ID } },
        note(records) { active(); for (const record of records) account.records.set(record.blobId, record) },
        list: async input => {
          authorize('listMemories', input)
          return { memories: [...account.records.values()].filter(record => record.namespace === input.namespace).map(record => ({
            memory_id: record.blobId, blob_id: record.blobId, namespace_id: record.namespace, created_at: record.createdAt, status: 'active',
          })), has_more: false }
        },
        destroy() { destroyed = true }, get destroyed() { return destroyed },
      }
      backends.push(backend)
      return backend
    },
  }
  return { accounts, calls, backends, dependencies }
}

export async function connectAccount(browser, account) {
  const tatum = await browser.json('/connections/tatum', { body: { apiKey: account.tatumKey } })
  if (tatum.status !== 200) throw new Error(`Synthetic Tatum connection failed: ${tatum.status}`)
  const memory = await browser.json('/connections/memwal', { body: { accountId: account.accountId, delegateKey: account.delegateKey } })
  if (memory.status !== 200) throw new Error(`Synthetic Walrus connection failed: ${memory.status}`)
  return memory
}
