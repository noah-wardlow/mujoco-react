import {
  applyPolicyActionToControls,
  useRemotePolicy,
  type PolicyActionChunk,
  type RemotePolicyResponseInfo,
} from '../src';

function RemotePolicyHarness() {
  const policy = useRemotePolicy({
    endpoint: 'http://127.0.0.1:8774/infer',
    frequency: 30,
    enabled: false,
    queueStrategy: 'replace',
    prefetchThreshold: 8,
    clearQueueOnStop: true,
    onObservation: ({ data }) => Array.from(data.qpos.slice(0, 6)),
    buildRequest: ({ observation, data, reset, requestIndex, signal }) => {
      signal.throwIfAborted();
      return {
        state: Array.from(observation),
        time: data.time,
        reset,
        requestIndex,
        images: {
          front: 'data:image/jpeg;base64,',
        },
      };
    },
    parseResponse: (body, info: RemotePolicyResponseInfo): PolicyActionChunk => {
      info.requestMs.toFixed();
      const response = body as { actions: number[][] };
      return response.actions;
    },
    onResponse: ({ responseBody, requestMs }) => {
      void responseBody;
      requestMs.toFixed();
    },
    onAction: ({ action, model, data }) => {
      applyPolicyActionToControls(model, data, action);
    },
  });

  policy.remoteStatus.toUpperCase();
  policy.requestCount.toFixed();
  policy.responseCount.toFixed();
  policy.lastHttpStatus?.toFixed();
  policy.lastRequestMs?.toFixed();
  policy.start();
  policy.abort();
  policy.stop();
  policy.reset();

  return null;
}

void RemotePolicyHarness;
