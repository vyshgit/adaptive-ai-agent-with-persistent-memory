import { useSyncExternalStore } from 'react'
import { NO_VAULT } from './deviceVault.ts'
import type { DeviceVault } from './deviceVault.ts'

const noSubscription = () => () => {}
const noSnapshot = () => NO_VAULT
export function useDeviceVault(vault: DeviceVault | null) {
  return useSyncExternalStore(vault?.subscribe || noSubscription, vault?.getSnapshot || noSnapshot, noSnapshot)
}
