# SnapshotInfo


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**snapshot_id** | **str** | Short VM ID (5-character alphanumeric) - used for filesystem operations | 
**source_vm_id** | **str** | Short VM ID (5-character alphanumeric) - used for filesystem operations | 
**account_id** | **str** | Account ID of the creator (if available) | [optional] 
**created_at** | **str** | When the snapshot was created | 
**name** | **str** | Optional name for the snapshot | [optional] 
**has_overlay** | **bool** | Whether the snapshot has an overlay filesystem | 
**rootfs_base** | **str** | The rootfs base ID if using overlayfs | [optional] 
**partition** | **str** | Partition ID where the snapshot is stored | [optional] 

## Example

```python
from freestyle_client.models.snapshot_info import SnapshotInfo

# TODO update the JSON string below
json = "{}"
# create an instance of SnapshotInfo from a JSON string
snapshot_info_instance = SnapshotInfo.from_json(json)
# print the JSON string representation of the object
print(SnapshotInfo.to_json())

# convert the object into a dict
snapshot_info_dict = snapshot_info_instance.to_dict()
# create an instance of SnapshotInfo from a dict
snapshot_info_from_dict = SnapshotInfo.from_dict(snapshot_info_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


