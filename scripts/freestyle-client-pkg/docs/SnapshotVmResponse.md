# SnapshotVmResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**snapshot_id** | **str** | Short VM ID (5-character alphanumeric) - used for filesystem operations | 
**source_vm_id** | **str** | Short VM ID (5-character alphanumeric) - used for filesystem operations | 

## Example

```python
from freestyle_client.models.snapshot_vm_response import SnapshotVmResponse

# TODO update the JSON string below
json = "{}"
# create an instance of SnapshotVmResponse from a JSON string
snapshot_vm_response_instance = SnapshotVmResponse.from_json(json)
# print the JSON string representation of the object
print(SnapshotVmResponse.to_json())

# convert the object into a dict
snapshot_vm_response_dict = snapshot_vm_response_instance.to_dict()
# create an instance of SnapshotVmResponse from a dict
snapshot_vm_response_from_dict = SnapshotVmResponse.from_dict(snapshot_vm_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


