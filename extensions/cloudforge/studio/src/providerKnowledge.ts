/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Documentation rules describe possible relationships, never evidence that a project's link exists. */
export type RelationshipCategory = 'ownership' | 'attachment' | 'execution' | 'reference' | 'runtime' | 'observability';
export type InfrastructureLayer = 'scope' | 'identity' | 'network' | 'security' | 'compute' | 'application' | 'data' | 'monitoring' | 'unknown';
export type RelationshipRule = { field: string; targets: string[]; category: RelationshipCategory; meaning: string };
export interface ResourceIntelligence {
	resourceType: string; platform: 'azure' | 'aws' | 'gcp' | 'kubernetes' | 'unknown';
	reviewStatus: 'documented' | 'unreviewed'; sourceKey?: string;
	fieldSyntax: 'terraform' | 'kubernetes-manifest' | 'unknown';
	parentTypes: string[]; childTypes: string[]; attachmentTypes: string[];
	commonDependencies: string[]; commonRuntimeLinks: string[]; securityRelationships: string[]; monitoringRelationships: string[];
	costCategory: string; blastRadiusCategory: string; layer: InfrastructureLayer;
	rules: RelationshipRule[]; troubleshooting: string[];
}
const rule = (field: string, targets: string, category: RelationshipCategory, meaning: string): RelationshipRule => ({ field, targets: targets.split(' '), category, meaning });
function profile(resourceType: string, layer: InfrastructureLayer, parents: string, cost: string, blast: string, rules: RelationshipRule[], troubleshooting: string[], runtime = '', security = '', monitoring = ''): ResourceIntelligence {
	const platform = resourceType.startsWith('azurerm_') ? 'azure' : resourceType.startsWith('aws_') ? 'aws' : resourceType.startsWith('google_') ? 'gcp' : 'kubernetes';
	return { resourceType, platform, reviewStatus: 'documented', fieldSyntax: platform === 'kubernetes' ? 'kubernetes-manifest' : 'terraform', sourceKey: platform + ':' + resourceType.replace(/^(azurerm|aws|google)_/, ''), layer,
		parentTypes: parents ? parents.split(' ') : [], childTypes: [], attachmentTypes: [...new Set(rules.filter(rule => rule.category === 'attachment').flatMap(rule => rule.targets))],
		commonDependencies: [...new Set(rules.flatMap(rule => rule.targets))], commonRuntimeLinks: runtime ? [runtime] : [], securityRelationships: security ? [security] : [], monitoringRelationships: monitoring ? [monitoring] : [],
		costCategory: cost, blastRadiusCategory: blast, rules, troubleshooting };
}
const azGroup = rule('resource_group_name', 'azurerm_resource_group', 'ownership', 'Resource group membership');
const az = (type: string, layer: InfrastructureLayer, rules: RelationshipRule[] = [], failures: string[] = [], cost: string = layer, blast = 'resource') => profile('azurerm_' + type, layer, 'azurerm_resource_group', cost, blast, [azGroup, ...rules], failures);
const awsVpc = rule('vpc_id', 'aws_vpc', 'ownership', 'VPC-scoped configuration');
const subnet = (field = 'subnet_id') => rule(field, 'aws_subnet', 'attachment', 'Subnet placement');
const sg = (field = 'vpc_security_group_ids') => rule(field, 'aws_security_group', 'attachment', 'Security group association; effective rules still need evaluation');
const aws = (type: string, layer: InfrastructureLayer, rules: RelationshipRule[] = [], failures: string[] = [], cost: string = layer, blast = 'resource') => profile('aws_' + type, layer, 'scope:aws-account', cost, blast, rules, failures);
const gcp = (type: string, layer: InfrastructureLayer, rules: RelationshipRule[] = [], failures: string[] = [], cost: string = layer, blast = 'resource') => profile('google_' + type, layer, 'scope:gcp-project', cost, blast, rules, failures);
const gcpNetwork = (field = 'network') => rule(field, 'google_compute_network', 'attachment', 'VPC network association; VPC is global and subnet is regional');
const gcpSubnet = (field = 'subnetwork') => rule(field, 'google_compute_subnetwork', 'attachment', 'Regional subnet placement');

export const documentedProfiles: ResourceIntelligence[] = [
	profile('azurerm_resource_group', 'scope', 'scope:azure-subscription', 'scope', 'ownership-scope', [], ['Group deletion affects owned Azure resources, including resources absent from this diagram.']),
	az('virtual_network', 'network', [], ['Overlapping address ranges can prevent peering.'], 'network', 'network-boundary'),
	az('subnet', 'network', [rule('virtual_network_name', 'azurerm_virtual_network', 'ownership', 'Subnet is an ARM child of the VNet')], ['CIDR must fit the VNet and not overlap another subnet.', 'Service-specific subnet delegation and reserved subnet requirements differ.'], 'network', 'network-boundary'),
	az('network_security_group', 'security', [], ['An NSG existing in a resource group does not apply it to a NIC or subnet.'], 'security', 'shared-policy'),
	az('network_security_rule', 'security', [rule('network_security_group_name', 'azurerm_network_security_group', 'ownership', 'Rule belongs to an NSG')], ['Priority conflicts or incompatible service tags can reject a rule.'], 'security', 'shared-policy'),
	profile('azurerm_subnet_network_security_group_association', 'security', '', 'association', 'shared-policy', [rule('subnet_id', 'azurerm_subnet', 'attachment', 'Association endpoint: subnet'), rule('network_security_group_id', 'azurerm_network_security_group', 'attachment', 'Association endpoint: NSG')], ['Subnet and NIC NSGs can both filter the same flow; one allow rule does not prove reachability.']),
	profile('azurerm_network_interface_security_group_association', 'security', '', 'association', 'workload-policy', [rule('network_interface_id', 'azurerm_network_interface', 'attachment', 'Association endpoint: NIC'), rule('network_security_group_id', 'azurerm_network_security_group', 'attachment', 'Association endpoint: NSG')], ['Review subnet and NIC effective security rules together.']),
	az('route_table', 'network', [], ['A route table has no effect on a subnet until associated.'], 'network', 'shared-traffic-path'),
	profile('azurerm_subnet_route_table_association', 'network', '', 'association', 'shared-traffic-path', [rule('subnet_id', 'azurerm_subnet', 'attachment', 'Route association endpoint: subnet'), rule('route_table_id', 'azurerm_route_table', 'attachment', 'Route association endpoint: table')], ['A next-hop IP does not establish firewall health or reciprocal routing.']),
	az('public_ip', 'network', [], ['Public IP allocation alone does not expose a workload without a frontend or NIC association.'], 'address', 'public-entrypoint'),
	az('network_interface', 'network', [rule('ip_configuration.subnet_id', 'azurerm_subnet', 'attachment', 'NIC IP configuration is placed in a subnet'), rule('ip_configuration.public_ip_address_id', 'azurerm_public_ip', 'attachment', 'Optional public IP association')], ['Static IP must be valid for the selected subnet.', 'A VM consumes NIC IDs; the NIC consumes a subnet ID.'], 'network', 'workload-network'),
	az('linux_virtual_machine', 'compute', [rule('network_interface_ids', 'azurerm_network_interface', 'attachment', 'Attach NICs to a VM'), rule('identity.identity_ids', 'azurerm_user_assigned_identity', 'attachment', 'Attach a user-assigned identity')], ['NIC, zone, region and image constraints must be compatible.', 'Inline reciprocal NSG rules can create Terraform reference cycles.'], 'compute', 'workload'),
	az('lb', 'network', [rule('frontend_ip_configuration.subnet_id', 'azurerm_subnet', 'attachment', 'Private frontend placement'), rule('frontend_ip_configuration.public_ip_address_id', 'azurerm_public_ip', 'attachment', 'Public frontend address')], ['Frontend, backend pool, rules and health probes are separate concerns.'], 'traffic', 'shared-traffic-path'),
	profile('azurerm_lb_backend_address_pool', 'network', 'azurerm_lb', 'traffic', 'shared-traffic-path', [rule('loadbalancer_id', 'azurerm_lb', 'ownership', 'Backend pool belongs to a load balancer')], ['A pool does not register a NIC by itself.']),
	profile('azurerm_network_interface_backend_address_pool_association', 'network', '', 'association', 'workload-network', [rule('network_interface_id', 'azurerm_network_interface', 'attachment', 'NIC backend registration'), rule('backend_address_pool_id', 'azurerm_lb_backend_address_pool', 'attachment', 'Pool endpoint')], ['The correct NIC IP configuration must be selected.']),
	az('application_gateway', 'network', [rule('gateway_ip_configuration.subnet_id', 'azurerm_subnet', 'attachment', 'Dedicated Application Gateway subnet'), rule('frontend_ip_configuration.public_ip_address_id', 'azurerm_public_ip', 'attachment', 'Public listener frontend'), rule('identity.identity_ids', 'azurerm_user_assigned_identity', 'attachment', 'Identity for supported integrations')], ['Dedicated subnet, backend health, probes, certificates, NSG and UDR constraints all matter.'], 'traffic', 'shared-traffic-path'),
	az('firewall', 'security', [rule('ip_configuration.subnet_id', 'azurerm_subnet', 'attachment', 'Firewall subnet placement'), rule('ip_configuration.public_ip_address_id', 'azurerm_public_ip', 'attachment', 'Firewall public IP')], ['A firewall resource alone does not route spoke traffic through it.', 'Review dedicated subnet requirements and UDR next hops.'], 'traffic-processing', 'shared-traffic-path'),
	az('virtual_network_peering', 'network', [rule('virtual_network_name', 'azurerm_virtual_network', 'ownership', 'Local VNet peering configuration'), rule('remote_virtual_network_id', 'azurerm_virtual_network', 'attachment', 'Remote VNet endpoint')], ['Peerings are not transitive.', 'Reciprocal peering and routing permissions need validation.'], 'network-transfer', 'network-boundary'),
	az('kubernetes_cluster', 'compute', [rule('default_node_pool.vnet_subnet_id', 'azurerm_subnet', 'attachment', 'Node pool subnet placement'), rule('identity.identity_ids', 'azurerm_user_assigned_identity', 'attachment', 'Cluster identity'), rule('oms_agent.log_analytics_workspace_id', 'azurerm_log_analytics_workspace', 'observability', 'Configured monitoring destination')], ['Subnet IP capacity, network plugin, egress and identity permissions can block deployment.', 'Identity assignment does not prove the required role assignment has propagated.'], 'managed-kubernetes', 'workload-platform'),
	az('user_assigned_identity', 'identity', [], ['Assigning an identity and granting permissions are distinct operations.'], 'identity', 'identity-access'),
	profile('azurerm_role_assignment', 'identity', '', 'identity', 'identity-access', [rule('principal_id', 'azurerm_user_assigned_identity azurerm_linux_virtual_machine azurerm_kubernetes_cluster', 'reference', 'Identity principal receiving the role'), rule('scope', '*', 'reference', 'Authorization scope; not resource ownership')], ['Principal propagation and actor permissions can fail role assignment.', 'A role assignment may need an explicit dependency if a consumer does not reference it.']),
	az('storage_account', 'data', [], ['RBAC, firewall rules, private endpoints and DNS independently affect data access.'], 'capacity-and-requests', 'stateful-data'),
	az('key_vault', 'security', [], ['Management-plane access does not imply secret access.', 'Inspect RBAC/access policy mode, network restrictions and identity grants.'], 'requests', 'identity-access'),
	az('log_analytics_workspace', 'monitoring', [], ['A workspace does not automatically collect every VM or cluster.'], 'ingestion-retention', 'observability'),
	profile('azurerm_monitor_diagnostic_setting', 'monitoring', '', 'telemetry', 'observability', [rule('target_resource_id', '*', 'observability', 'Resource whose diagnostic categories are configured'), rule('log_analytics_workspace_id', 'azurerm_log_analytics_workspace', 'observability', 'Telemetry destination'), rule('storage_account_id', 'azurerm_storage_account', 'observability', 'Optional storage destination')], ['Supported categories differ by resource; diagnostic settings are not the same as guest-agent data collection.']),

	aws('vpc', 'network', [], ['A VPC alone does not create a working egress path.'], 'network', 'network-boundary'),
	aws('subnet', 'network', [awsVpc], ['Subnet belongs to one availability zone.', 'A public subnet needs appropriate route and addressing configuration.'], 'network', 'network-boundary'),
	aws('security_group', 'security', [awsVpc], ['Referencing another group does not attach that group to a workload.', 'Separate rule resources can avoid inline reciprocal reference cycles.'], 'security', 'shared-policy'),
	aws('vpc_security_group_ingress_rule', 'security', [rule('security_group_id', 'aws_security_group', 'ownership', 'Rule configuration for a security group'), rule('referenced_security_group_id', 'aws_security_group', 'reference', 'Source group in a traffic rule; not ownership')]),
	aws('route_table', 'network', [awsVpc, rule('route.nat_gateway_id', 'aws_nat_gateway', 'attachment', 'NAT route next hop'), rule('route.gateway_id', 'aws_internet_gateway', 'attachment', 'Internet gateway route next hop')], ['Only the effective subnet association determines which routes apply.'], 'network', 'shared-traffic-path'),
	aws('route_table_association', 'network', [subnet(), rule('route_table_id', 'aws_route_table', 'attachment', 'Subnet route-table association')], ['A subnet without an explicit association uses the VPC main route table.']),
	aws('nat_gateway', 'network', [subnet()], ['NAT placement, routing, addressing and gateway reachability must agree.', 'An egress NAT path is not an inbound application endpoint.'], 'traffic-processing', 'shared-egress'),
	aws('internet_gateway', 'network', [rule('vpc_id', 'aws_vpc', 'attachment', 'Attach internet gateway to VPC')], ['Attaching an internet gateway is insufficient without routes and suitable workload addressing.'], 'network', 'shared-egress'),
	aws('network_interface', 'network', [subnet(), sg('security_groups')], ['ENIs are zonal; attachment compatibility and interface indexes matter.'], 'network', 'workload-network'),
	aws('instance', 'compute', [subnet(), sg(), rule('primary_network_interface.network_interface_id', 'aws_network_interface', 'attachment', 'Explicit primary ENI attachment'), rule('iam_instance_profile', 'aws_iam_instance_profile', 'attachment', 'Instance profile associated with the instance')], ['A subnet, ENI, group, AMI and instance type must satisfy provider constraints.', 'IAM policy readiness may be a hidden dependency.'], 'compute', 'workload'),
	aws('eks_cluster', 'compute', [rule('vpc_config.subnet_ids', 'aws_subnet', 'attachment', 'Cluster network placement'), sg('vpc_config.security_group_ids'), rule('role_arn', 'aws_iam_role', 'attachment', 'EKS control-plane role')], ['Subnet availability-zone coverage, IP capacity, IAM policies and endpoint access can fail independently.'], 'managed-kubernetes', 'workload-platform'),
	aws('eks_node_group', 'compute', [rule('cluster_name', 'aws_eks_cluster', 'ownership', 'Managed node group belongs to EKS cluster'), rule('subnet_ids', 'aws_subnet', 'attachment', 'Worker placement'), rule('node_role_arn', 'aws_iam_role', 'attachment', 'Node IAM role')], ['Private workers need supported egress or endpoints and the required node role policies.'], 'compute', 'workload-platform'),
	aws('lb', 'network', [rule('subnets', 'aws_subnet', 'attachment', 'ALB/NLB subnet placement'), sg('security_groups')], ['ALB and NLB behavior differs; do not infer listeners, target health or traffic from placement.'], 'traffic', 'shared-traffic-path'),
	aws('lb_target_group', 'network', [awsVpc], ['Target type and health checks must match registered backends.'], 'traffic', 'shared-traffic-path'),
	aws('lb_listener', 'network', [rule('load_balancer_arn', 'aws_lb', 'ownership', 'Listener belongs to a load balancer'), rule('default_action.target_group_arn', 'aws_lb_target_group', 'attachment', 'Forwarding action destination')], ['Listener rules, protocol and certificate requirements must be satisfied.']),
	aws('lb_target_group_attachment', 'network', [rule('target_group_arn', 'aws_lb_target_group', 'attachment', 'Target registration group'), rule('target_id', 'aws_instance aws_network_interface aws_lambda_function', 'attachment', 'Configured target, dependent on target type')], ['An IP target may be a literal address and need not correspond to a model node.']),
	aws('db_subnet_group', 'network', [rule('subnet_ids', 'aws_subnet', 'attachment', 'DB subnet group membership')], ['Review the selected engine and availability-zone coverage.']),
	aws('db_instance', 'data', [rule('db_subnet_group_name', 'aws_db_subnet_group', 'attachment', 'RDS network placement'), sg()], ['Security groups, DNS, authentication, engine settings and subnet coverage can fail separately.', 'Deletion protection and snapshot policy affect destroy workflows.'], 'database-capacity', 'stateful-data'),
	aws('iam_role', 'identity', [], ['Trust policy and attached permission policies are different relationships.'], 'identity', 'identity-access'),
	aws('iam_instance_profile', 'identity', [rule('role', 'aws_iam_role', 'attachment', 'Role within EC2 instance profile')]),
	aws('iam_policy', 'identity', [], ['A policy existing in an account is not evidence that it is attached to a principal.'], 'identity', 'identity-access'),
	aws('iam_role_policy_attachment', 'identity', [rule('role', 'aws_iam_role', 'attachment', 'Attach permission policy to role'), rule('policy_arn', 'aws_iam_policy', 'attachment', 'Permission policy')], ['Policy references and runtime permissions do not establish application reachability.']),
	aws('s3_bucket', 'data', [], ['S3 is not placed in a subnet.', 'Policy, public-access controls, encryption and VPC endpoints are separate configuration.'], 'capacity-and-requests', 'stateful-data'),
	aws('lambda_function', 'application', [rule('role', 'aws_iam_role', 'attachment', 'Execution role'), rule('vpc_config.subnet_ids', 'aws_subnet', 'attachment', 'Optional VPC placement'), sg('vpc_config.security_group_ids')], ['VPC placement can remove default internet access.', 'IAM, ENI capacity, DNS and application permissions are separate failure causes.'], 'execution-requests', 'workload'),
	aws('route53_zone', 'network', [], ['Public and private hosted zones have different resolution scopes.'], 'dns', 'name-resolution'),
	aws('route53_record', 'network', [rule('zone_id', 'aws_route53_zone', 'ownership', 'Record belongs to a hosted zone'), rule('alias.name', 'aws_lb', 'reference', 'Alias target name, if explicitly linked')], ['A DNS record is not evidence of backend availability or security policy.'], 'dns', 'name-resolution'),
	aws('organizations_organization', 'scope', [], ['Multiple VPCs alone do not establish an AWS landing zone.'], 'scope', 'organization-scope'),
	aws('organizations_account', 'scope', [rule('parent_id', 'aws_organizations_organizational_unit', 'ownership', 'Account organizational placement')], ['Account boundaries, delegated administration and baseline controls require explicit evidence.'], 'scope', 'account-scope'),

	gcp('compute_network', 'network', [], ['VPC networks are global; do not nest them beneath a single region.'], 'network', 'network-boundary'),
	gcp('compute_subnetwork', 'network', [rule('network', 'google_compute_network', 'ownership', 'Regional subnetwork belongs to a global VPC')], ['Primary and secondary ranges must fit regional and cluster requirements.'], 'network', 'network-boundary'),
	gcp('compute_firewall', 'security', [rule('network', 'google_compute_network', 'ownership', 'Firewall rule is scoped to a VPC')], ['Tags and service-account selectors select traffic targets; they do not attach IAM permissions.'], 'security', 'shared-policy'),
	gcp('compute_instance', 'compute', [gcpNetwork('network_interface.network'), gcpSubnet('network_interface.subnetwork'), rule('service_account.email', 'google_service_account', 'attachment', 'Runtime service account')], ['Instance zone and subnetwork region must be compatible.', 'Scopes and IAM permissions are separate; updates can require stopping the VM.'], 'compute', 'workload'),
	gcp('container_cluster', 'compute', [gcpNetwork(), gcpSubnet(), rule('node_config.service_account', 'google_service_account', 'attachment', 'Node service account')], ['IP ranges, endpoint isolation, egress and workload identity configuration require separate validation.'], 'managed-kubernetes', 'workload-platform'),
	gcp('sql_database_instance', 'data', [gcpNetwork('settings.ip_configuration.private_network')], ['Private services access or the selected Private Service Connect design must be configured.', 'The necessary APIs and service-networking permissions may not be represented by the network reference alone.'], 'database-capacity', 'stateful-data'),
	gcp('storage_bucket', 'data', [], ['A bucket is not owned by a subnet.', 'IAM, public access prevention and encryption govern access independently.'], 'capacity-and-requests', 'stateful-data'),
	gcp('service_account', 'identity', [], ['Creating a service account does not grant it permissions or attach it to a workload.'], 'identity', 'identity-access'),
	gcp('project_iam_member', 'identity', [rule('member', 'google_service_account', 'reference', 'Principal receiving a project role')], ['IAM member, binding and policy resources have different authority and can conflict if mixed for the same role.'], 'identity', 'identity-access'),
	gcp('compute_router', 'network', [gcpNetwork()], ['Cloud Router is a regional control-plane configuration, not a packet-forwarding VM.'], 'network', 'shared-egress'),
	gcp('compute_router_nat', 'network', [rule('router', 'google_compute_router', 'ownership', 'NAT configuration associated with a Cloud Router'), gcpSubnet('subnetwork.name')], ['Cloud NAT requires a compatible region and selected subnet ranges; it does not provide unsolicited inbound access.'], 'traffic-processing', 'shared-egress'),
	gcp('compute_network_peering', 'network', [gcpNetwork(), gcpNetwork('peer_network')], ['Peering is not a transit service; verify reciprocal configuration and route import/export requirements.'], 'network-transfer', 'network-boundary'),
	gcp('compute_forwarding_rule', 'network', [rule('backend_service', 'google_compute_region_backend_service', 'attachment', 'Regional backend destination for supported forwarding-rule modes'), rule('target', 'google_compute_region_target_http_proxy', 'attachment', 'Regional target HTTP proxy for supported load-balancing modes'), gcpNetwork(), gcpSubnet()], ['Regional/global resources and load-balancing schemes must match; this is not a complete list of supported target kinds.'], 'traffic', 'shared-traffic-path'),
	gcp('compute_global_forwarding_rule', 'network', [rule('target', 'google_compute_target_http_proxy', 'attachment', 'Global target HTTP proxy for supported load-balancing modes')], ['A global frontend must use a compatible target and load-balancing scheme; HTTPS, TCP and other target kinds need their own reviewed rules.'], 'traffic', 'shared-traffic-path'),
	gcp('compute_backend_service', 'network', [], ['Backend groups, health checks and regional/global mode determine the traffic path.'], 'traffic', 'shared-traffic-path'),
	gcp('compute_region_backend_service', 'network', [], ['Regional backend groups, health checks and balancing scheme must be compatible.'], 'traffic', 'shared-traffic-path'),
	gcp('compute_url_map', 'network', [rule('default_service', 'google_compute_backend_service', 'attachment', 'Default backend service')]),
	gcp('compute_region_url_map', 'network', [rule('default_service', 'google_compute_region_backend_service', 'attachment', 'Regional default backend service')]),
	gcp('compute_target_http_proxy', 'network', [rule('url_map', 'google_compute_url_map', 'attachment', 'Proxy URL-map binding')]),
	gcp('compute_region_target_http_proxy', 'network', [rule('url_map', 'google_compute_region_url_map', 'attachment', 'Regional proxy URL-map binding')]),
	gcp('monitoring_alert_policy', 'monitoring', [], ['A metric filter is not an ownership relationship; monitored resources may be outside the diagram.'], 'telemetry', 'observability'),
	gcp('logging_project_sink', 'monitoring', [rule('destination', 'google_storage_bucket', 'observability', 'Explicit log destination, if the expression is linked')], ['The sink writer identity also needs permission on the destination.'], 'ingestion-retention', 'observability'),
];

const namespace = rule('metadata.namespace', 'kubernetes_namespace_v1', 'ownership', 'Namespace scope; not a controller ownerReference');
const podInputs = [rule('spec.volumes.persistentVolumeClaim.claimName', 'kubernetes_persistent_volume_claim_v1', 'attachment', 'Namespaced storage claim'), rule('spec.volumes.configMap.name', 'kubernetes_config_map_v1', 'reference', 'Configuration volume'), rule('spec.volumes.secret.secretName', 'kubernetes_secret_v1', 'reference', 'Secret volume; never collect its contents')];
function k8s(type: string, source: string, layer: InfrastructureLayer, rules: RelationshipRule[], failures: string[], clusterScoped = false) {
	const value = profile('kubernetes_' + type + '_v1', layer, clusterScoped ? 'scope:kubernetes-cluster' : 'kubernetes_namespace_v1', 'platform-dependent', layer === 'data' ? 'stateful-data' : 'workload', clusterScoped ? rules : [namespace, ...rules], failures);
	value.sourceKey = 'kubernetes:' + source;
	return value;
}
// These field paths are Kubernetes manifest paths. A future Kubernetes provider adapter must map
// its versioned schema before using them for Terraform fields; this does not add provider support.
documentedProfiles.push(
	k8s('namespace', 'namespaces', 'scope', [], ['Namespace scope is distinct from ownerReferences.', 'Namespaces cannot nest; cluster-scoped PVs are not namespace children.'], true),
	k8s('pod', '_index', 'compute', [...podInputs, rule('metadata.ownerReferences', '*', 'ownership', 'Actual controller ownership comes from ownerReferences, not matching labels')], ['Referenced Secret, ConfigMap and PVC must satisfy namespace and scheduling requirements.', 'Container readiness is not established by a manifest reference.']),
	k8s('deployment', 'deployment', 'application', [rule('metadata.ownerReferences', '*', 'ownership', 'Observed ownership only; controllers own ReplicaSets and their Pods')], ['A matching Service selector does not own the Deployment or Pods.', 'Ready replicas and rollout state require observed status.']),
	k8s('stateful_set', 'statefulset', 'application', [rule('spec.serviceName', 'kubernetes_service_v1', 'reference', 'Governing service for network identity')], ['Stateful identity, volume claims and governing service have distinct lifecycles.', 'PVC retention and finalizers affect removal.']),
	k8s('daemon_set', 'daemonset', 'application', [], ['Placement follows eligible nodes, affinity and taints, not every node unconditionally.']),
	k8s('service', 'service', 'network', [rule('spec.selector', 'kubernetes_pod_v1', 'runtime', 'Configured selector intent; ready EndpointSlices are additional evidence')], ['Selector matches do not establish readiness, network-policy permission or successful traffic.', 'ExternalName and selectorless Services do not follow the selector-to-Pod model.']),
	k8s('ingress', 'ingress', 'network', [rule('spec.rules.http.paths.backend.service.name', 'kubernetes_service_v1', 'runtime', 'Configured backend routing intent'), rule('spec.tls.secretName', 'kubernetes_secret_v1', 'reference', 'TLS certificate reference')], ['Requires a compatible controller and class; the object alone does not provide a working load balancer.']),
	k8s('config_map', 'configmap', 'application', [], ['Volume, environment and subPath update behaviors differ; changing a ConfigMap does not uniformly restart Pods.']),
	k8s('secret', 'secret', 'security', [], ['Graph analysis uses names/references only, never secret contents.', 'Base64 encoding is not encryption.']),
	k8s('persistent_volume_claim', 'persistent-volumes', 'data', [rule('spec.volumeName', 'kubernetes_persistent_volume_v1', 'attachment', 'Explicit PV binding request')], ['Storage class, capacity, access mode and topology must be compatible.', 'WaitForFirstConsumer can defer binding until scheduling.']),
	k8s('persistent_volume', 'persistent-volumes', 'data', [rule('spec.claimRef', 'kubernetes_persistent_volume_claim_v1', 'attachment', 'PV claim binding')], ['Cluster-scoped volume; reclaim policy and protection finalizers affect deletion.'], true),
	k8s('storage_class', 'storage-classes', 'data', [], ['Provisioner, binding mode, reclaim policy and allowed topologies shape dynamic volumes.'], true)
);

// Investigation prompts describe the extra evidence needed; they never create instance links.
const investigations: Record<string, { runtime?: string; security?: string; monitoring?: string }> = {
	azurerm_resource_group: { security: 'Azure RBAC scope and inherited assignments apply independently of diagram grouping.' },
	azurerm_virtual_network: { runtime: 'Peering and routes can connect networks; peering is not transitive.', security: 'Subnet/NIC NSGs and routing govern flows independently.' },
	azurerm_subnet: { runtime: 'Check effective routes and NIC placement; visual contents alone do not establish a network attachment.', security: 'An explicit subnet NSG association applies security rules.' },
	azurerm_linux_virtual_machine: { runtime: 'NIC IP configuration provides network placement. Application-to-database access needs routing, DNS, authentication and policy evidence.', monitoring: 'Guest collection requires the applicable Azure Monitor agent, data collection rule and association; a Log Analytics workspace alone is insufficient.' },
	azurerm_kubernetes_cluster: { runtime: 'Key Vault access needs a workload identity or supported identity integration plus network access and grants.', security: 'Cluster identity, network contributor permissions and workload identity grants are different relationships.', monitoring: 'oms_agent.log_analytics_workspace_id describes configured collection, not observed delivery or health.' },
	azurerm_key_vault: { security: 'RBAC/access policy mode, principal grants and network restrictions all affect data-plane access.' },
	azurerm_storage_account: { security: 'Identity/RBAC, network firewall, private endpoint DNS and account policy are separate controls.', monitoring: 'Diagnostic settings select categories and destinations; they do not establish successful ingestion.' },
	aws_vpc: { runtime: 'Subnet route-table selection, NAT/internet gateways and addressing establish potential egress paths.' },
	aws_security_group: { security: 'Group references describe traffic rules; ENI associations determine which groups protect a workload.' },
	aws_instance: { runtime: 'Subnet/ENI placement and route tables determine potential paths; group rules and endpoint health require separate checks.', security: 'EC2 instance profile, IAM role trust and attached permissions must agree.' },
	aws_eks_cluster: { runtime: 'Control-plane endpoint mode, worker subnet egress and security groups shape cluster connectivity.', monitoring: 'Control-plane logging settings and CloudWatch permissions are additional evidence.' },
	aws_lb: { runtime: 'Listeners, rules, target registration and health checks establish configured forwarding; ALB and NLB differ.' },
	aws_db_instance: { runtime: 'A DB subnet group is placement, not proof that an application can connect.', security: 'Review network groups, database authentication and encryption separately.' },
	aws_lambda_function: { runtime: 'Optional VPC ENIs, NAT/endpoints and DNS affect access to external services.', security: 'Execution role policy is distinct from invocation permissions.', monitoring: 'CloudWatch log writes require execution-role permissions; delivery is not implied by the function resource.' },
	aws_s3_bucket: { security: 'Bucket policy, principal policy, public-access controls and encryption are distinct; a bucket has no subnet ownership.' },
	google_compute_network: { runtime: 'A global VPC spans regional subnets. Routes and firewall policies are additional connectivity evidence.' },
	google_compute_instance: { security: 'Service-account attachment, API scopes and IAM permissions are different constraints.', monitoring: 'Ops Agent configuration and logging/monitoring permissions need separate evidence.' },
	google_container_cluster: { runtime: 'Cluster endpoint isolation, ranges and egress mode must be checked alongside subnet placement.', security: 'Node service account and Workload Identity bindings are separate relationships.' },
	google_sql_database_instance: { runtime: 'Private services access or Private Service Connect prerequisites are not established by a VPC reference.' },
	google_compute_router_nat: { runtime: 'Regional Cloud NAT provides eligible outbound translation, not unsolicited inbound connectivity.' },
	kubernetes_service_v1: { runtime: 'Selectors express routing intent; ready EndpointSlices, network policy and service mode need observed evidence.' },
	kubernetes_pod_v1: { security: 'Namespaced Secret references do not establish permissions or expose secret contents.', monitoring: 'Readiness, events and container status require a Kubernetes observation adapter.' }
};
// Inverse structural metadata is a type-level possibility, never an instance ownership assertion.
for (const parent of documentedProfiles) {
	parent.childTypes = documentedProfiles.filter(child => child.parentTypes.includes(parent.resourceType) || child.rules.some(rule => rule.category === 'ownership' && rule.targets.includes(parent.resourceType))).map(child => child.resourceType);
	const prompts = investigations[parent.resourceType];
	parent.commonRuntimeLinks = prompts?.runtime ? [prompts.runtime] : [];
	parent.securityRelationships = prompts?.security ? [prompts.security] : [];
	parent.monitoringRelationships = prompts?.monitoring ? [prompts.monitoring] : [];
}
const profiles = new Map(documentedProfiles.map(profile => [profile.resourceType, profile]));
export function resourceIntelligence(resourceType: string): ResourceIntelligence {
	return profiles.get(resourceType) ?? { resourceType, platform: 'unknown', reviewStatus: 'unreviewed', fieldSyntax: 'unknown', parentTypes: [], childTypes: [], attachmentTypes: [], commonDependencies: [], commonRuntimeLinks: [], securityRelationships: [], monitoringRelationships: [], costCategory: 'unknown', blastRadiusCategory: 'unknown', layer: 'unknown', rules: [], troubleshooting: ['No reviewed provider relationship rules for this type. Inspect its version-matched schema and configuration.'] };
}
export const infrastructureLayers: InfrastructureLayer[] = ['scope', 'identity', 'network', 'security', 'compute', 'application', 'data', 'monitoring', 'unknown'];
