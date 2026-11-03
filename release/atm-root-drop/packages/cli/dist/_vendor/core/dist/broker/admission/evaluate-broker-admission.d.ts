import type { BrokerAdmissionPolicy, BrokerAdmissionRegistry, BrokerAdmissionRequest, BrokerAdmissionResult } from './contracts.js';
export declare function evaluateBrokerAdmission(request: BrokerAdmissionRequest, registry: BrokerAdmissionRegistry, policy: BrokerAdmissionPolicy): BrokerAdmissionResult;
