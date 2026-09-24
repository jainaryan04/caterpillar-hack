/**
 * The operator using this phone (a worker_id from the Fleet API). Set by the
 * worker picker; read by clients that need to identify the phone, such as the
 * Cat agent's per-operator screen session.
 */
let currentWorkerId: string | undefined;

export const session = {
  get workerId() {
    return currentWorkerId;
  },
  set(workerId: string | undefined) {
    currentWorkerId = workerId;
  },
};
