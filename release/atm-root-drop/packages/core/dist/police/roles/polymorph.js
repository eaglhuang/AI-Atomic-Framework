import { buildPolymorphSuppressionKey, DEFAULT_POLYMORPH_VARIANT_THRESHOLD } from '../suppression-keys.js';
import { makeEvidenceRef, makePoliceFinding, makePoliceFamilyReport, sanitizeId } from '../shared.js';
export function runPolymorphPolice(input = {}) {
    const template = input.template;
    const instances = input.instances ?? [];
    const threshold = input.variantThreshold ?? DEFAULT_POLYMORPH_VARIANT_THRESHOLD;
    const suppressed = new Set(input.suppressedKeys ?? []);
    const findings = [];
    if (template) {
        for (const instance of instances) {
            if (instance.templateId !== template.templateId)
                continue;
            const inheritedVersion = instance.inheritedTemplateVersion ?? instance.parentTemplateVersion;
            if (inheritedVersion && inheritedVersion !== template.templateVersion) {
                const key = buildPolymorphSuppressionKey({
                    templateId: template.templateId,
                    signalKind: 'template-drift',
                    instanceId: instance.instanceId,
                    templateVersion: template.templateVersion
                });
                if (!suppressed.has(key)) {
                    findings.push(makePoliceFinding({
                        findingId: `police.polymorph.template-drift.${sanitizeId(instance.instanceId)}`,
                        policeFamily: 'polymorph',
                        severity: 'advisory',
                        trigger: 'template-drift',
                        scope: `${template.templateId}@${template.templateVersion}->${instance.instanceId}`,
                        action: 'needs-review',
                        routeHint: 'behavior.polymorphize',
                        readModel: 'PolymorphTemplate.instances',
                        message: `Instance ${instance.instanceId} parent template ${inheritedVersion} drifted from template ${template.templateVersion}.`,
                        evidenceRefs: [makeEvidenceRef('polymorph-template-record', 'police-artifact')],
                        metadata: {
                            templateId: template.templateId,
                            templateVersion: template.templateVersion,
                            instanceId: instance.instanceId,
                            inheritedVersion,
                            suppressionKey: key,
                            directApplyAllowed: false
                        }
                    }));
                }
            }
            if (instance.dimensionDriftTags && instance.dimensionDriftTags.length > 0) {
                const key = buildPolymorphSuppressionKey({
                    templateId: template.templateId,
                    signalKind: 'polymorph-dimension-drift',
                    instanceId: instance.instanceId,
                    templateVersion: template.templateVersion
                });
                if (!suppressed.has(key)) {
                    findings.push(makePoliceFinding({
                        findingId: `police.polymorph.dimension-drift.${sanitizeId(instance.instanceId)}`,
                        policeFamily: 'polymorph',
                        severity: 'advisory',
                        trigger: 'polymorph-dimension-drift',
                        scope: `${template.templateId}->${instance.instanceId}`,
                        action: 'needs-review',
                        routeHint: 'behavior.polymorphize',
                        readModel: 'PolymorphTemplate.dimensionSpec',
                        message: `Instance ${instance.instanceId} reports dimension drift tags: ${[...instance.dimensionDriftTags].join(', ')}.`,
                        evidenceRefs: [makeEvidenceRef('polymorph-dimension-record', 'police-artifact')],
                        metadata: {
                            templateId: template.templateId,
                            instanceId: instance.instanceId,
                            dimensionDriftTags: [...instance.dimensionDriftTags],
                            suppressionKey: key,
                            directApplyAllowed: false
                        }
                    }));
                }
            }
        }
        const propagatedInstances = instances.filter((instance) => instance.templateId === template.templateId);
        const missingPropagation = propagatedInstances.filter((instance) => {
            const inheritedVersion = instance.inheritedTemplateVersion ?? instance.parentTemplateVersion;
            return !inheritedVersion || inheritedVersion !== template.templateVersion;
        });
        if (missingPropagation.length > 0 && propagatedInstances.length > 0) {
            const propagationKey = buildPolymorphSuppressionKey({
                templateId: template.templateId,
                signalKind: 'instance-propagation-missing',
                templateVersion: template.templateVersion
            });
            if (!suppressed.has(propagationKey)) {
                findings.push(makePoliceFinding({
                    findingId: `police.polymorph.instance-propagation-missing.${sanitizeId(template.templateId)}.${sanitizeId(template.templateVersion)}`,
                    policeFamily: 'polymorph',
                    severity: 'warning',
                    trigger: 'instance-propagation-missing',
                    scope: `${template.templateId}@${template.templateVersion}`,
                    action: 'request-human-review',
                    routeHint: 'behavior.polymorphize',
                    readModel: 'PolymorphTemplate.instances',
                    message: `${missingPropagation.length}/${propagatedInstances.length} polymorph instances missing propagation to template ${template.templateVersion}.`,
                    evidenceRefs: [makeEvidenceRef('polymorph-propagation-log', 'police-artifact')],
                    metadata: {
                        templateId: template.templateId,
                        templateVersion: template.templateVersion,
                        missingInstanceIds: missingPropagation.map((entry) => entry.instanceId),
                        suppressionKey: propagationKey,
                        directApplyAllowed: false
                    }
                }));
            }
        }
        if (propagatedInstances.length > threshold) {
            const variantKey = buildPolymorphSuppressionKey({
                templateId: template.templateId,
                signalKind: 'variant-explosion',
                templateVersion: template.templateVersion
            });
            if (!suppressed.has(variantKey)) {
                findings.push(makePoliceFinding({
                    findingId: `police.polymorph.variant-explosion.${sanitizeId(template.templateId)}`,
                    policeFamily: 'polymorph',
                    severity: 'warning',
                    trigger: 'variant-explosion',
                    scope: template.templateId,
                    action: 'request-human-review',
                    routeHint: 'behavior.evolve',
                    readModel: 'PolymorphTemplate.instances',
                    message: `Polymorph template ${template.templateId} has ${propagatedInstances.length} instances (threshold ${threshold}).`,
                    evidenceRefs: [makeEvidenceRef('polymorph-template-record', 'police-artifact')],
                    metadata: {
                        templateId: template.templateId,
                        instanceCount: propagatedInstances.length,
                        variantThreshold: threshold,
                        suppressionKey: variantKey,
                        directApplyAllowed: false
                    }
                }));
            }
        }
    }
    return makePoliceFamilyReport({
        family: 'polymorph',
        mode: 'advisory',
        status: 'pass',
        findings,
        sourceValidator: 'runPolymorphPolice'
    });
}
