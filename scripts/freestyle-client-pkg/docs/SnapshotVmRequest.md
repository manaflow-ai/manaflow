# SnapshotVmRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** | Optional name/label for the snapshot | [optional] 

## Example

```python
from freestyle_client.models.snapshot_vm_request import SnapshotVmRequest

# TODO update the JSON string below
json = "{}"
# create an instance of SnapshotVmRequest from a JSON string
snapshot_vm_request_instance = SnapshotVmRequest.from_json(json)
# print the JSON string representation of the object
print(SnapshotVmRequest.to_json())

# convert the object into a dict
snapshot_vm_request_dict = snapshot_vm_request_instance.to_dict()
# create an instance of SnapshotVmRequest from a dict
snapshot_vm_request_from_dict = SnapshotVmRequest.from_dict(snapshot_vm_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


