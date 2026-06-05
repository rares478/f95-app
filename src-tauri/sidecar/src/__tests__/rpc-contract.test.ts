import { describe, expect, it } from 'vitest';
import { RPC_METHODS } from '../contract/rpc-methods';
import { createHandlerRegistry } from '../rpc/registry';
import { AppContext } from '../domain/context';

describe('RPC contract', () => {
  it('registry exposes all contract methods', () => {
    const registry = createHandlerRegistry(new AppContext());
    const registryMethods = Object.keys(registry).sort();
    const contractMethods = Object.keys(RPC_METHODS).sort();
    expect(registryMethods).toEqual(contractMethods);
  });
});
