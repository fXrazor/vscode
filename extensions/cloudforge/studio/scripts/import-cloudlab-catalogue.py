"""Import the user-owned CloudLab catalogue snapshots and only their referenced icon assets.
Reads the source checkout; writes exclusively beneath this standalone preview's assets.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
args = parser.parse_args()
source = args.source.resolve()
studio = Path(__file__).resolve().parents[1]
catalogue = source / "apps/web/public/catalog"
icons = source / "apps/web/public/icons"
output = studio / "assets/catalogue"
output.mkdir(parents=True, exist_ok=True)
curated = json.loads((catalogue / "curated.json").read_text())["resources"]
known_icons = {
 "azurerm_resource_group":"azure/azure-resource-groups.svg",
 "azurerm_virtual_network":"azure/azure-virtual-networks.svg",
 "azurerm_subnet":"azure/azure-subnet.svg",
 "azurerm_kubernetes_cluster":"azure/azure-kubernetes-services.svg",
 "azurerm_linux_virtual_machine":"azure/azure-virtual-machine.svg",
 "azurerm_network_interface":"azure/azure-network-interfaces.svg",
 "azurerm_network_security_group":"azure/azure-network-security-groups.svg",
 "azurerm_storage_account":"azure/azure-storage-accounts.svg",
 "azurerm_log_analytics_workspace":"azure/azure-log-analytics-workspaces.svg",
 "azurerm_key_vault":"azure/azure-key-vaults.svg",
}
manifest = {}
for original, provider in [("azurerm","azure"),("aws","aws"),("google","gcp")]:
 index_path = catalogue/original/"index.json"
 index = json.loads(index_path.read_text())
 definitions = {r["type"]:r for r in curated if r["provider"] == original}
 for path in (catalogue/original).glob("*.json"):
  if path.name != "index.json":
   definitions.update({r["type"]:r for r in json.loads(path.read_text()).get("resources",[])})
 records = {}
 for row in index["entries"]:
  record = dict(zip(index["fields"], row))
  records[record["type"]] = record
 for type_name, service, category in index.get("curated",[]):
  definition = definitions[type_name]
  records[type_name] = {"type":type_name,"displayName":definition["displayName"],"service":service,"category":category,"icon":known_icons.get(type_name,""),"curated":True}
 result = []
 for record in records.values():
  icon = record.get("icon","")
  source_icon = (icons/icon).resolve()
  if icon and icons.resolve() in source_icon.parents and source_icon.is_file():
   target = studio/"assets/catalog-icons"/icon
   target.parent.mkdir(parents=True,exist_ok=True)
   shutil.copyfile(source_icon,target)
   asset_icon = "catalog-icons/"+icon
  else:
   asset_icon = "azure-resource-groups.svg"
  fields = []
  for field in definitions.get(record["type"],{}).get("attributes",[]):
   if field.get("type") in ("string","number","bool") and not field.get("computed"):
    fields.append({k:field[k] for k in ("name","type","required","description","default","options","sensitive") if k in field})
  result.append({"type":record["type"],"label":record["displayName"],"service":record["service"],"category":record["category"],"icon":asset_icon,"fields":fields,"curated":record.get("curated",False),"iconMatch":record.get("iconMatch","generic")})
 payload={"provider":provider,"version":index["version"],"source":"hashicorp/"+original,"entries":sorted(result,key=lambda r:r["label"])}
 (output/(provider+".json")).write_text(json.dumps(payload,separators=(",",":")),encoding="utf-8")
 manifest[provider]={"version":index["version"],"entries":len(result),"indexSha256":hashlib.sha256(index_path.read_bytes()).hexdigest()}
(output/"provenance.json").write_text(json.dumps(manifest,indent=2))
print(json.dumps(manifest))
