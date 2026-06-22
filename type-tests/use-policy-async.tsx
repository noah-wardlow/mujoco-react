import { usePolicy, type PolicyActionChunk, type PolicyVector } from '../src';

function RemoteChunkedPolicyHarness() {
  const policy = usePolicy({
    frequency: 50,
    enabled: false,
    queueStrategy: 'replace',
    prefetchThreshold: 8,
    clearQueueOnStop: true,
    onObservation: ({ data }): PolicyVector => {
      return Array.from(data.qpos.slice(0, 6));
    },
    infer: async ({ observation, data }): Promise<PolicyActionChunk> => {
      const response = await Promise.resolve({
        actions: [
          Array.from(observation),
          Array.from(data.ctrl.slice(0, 6)),
        ],
      });
      return response.actions;
    },
    onAction: ({ action, model, data }) => {
      for (let index = 0; index < Math.min(model.nu, action.length); index += 1) {
        data.ctrl[index] = action[index];
      }
    },
    onError: (error) => {
      void error;
    },
  });

  policy.inFlight.valueOf();
  policy.queuedActions.toFixed();
  policy.lastError?.toString();
  policy.start();
  policy.stop();
  policy.clearQueue();
  policy.reset();

  return null;
}

void RemoteChunkedPolicyHarness;
