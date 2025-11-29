# VmPersistence


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**priority** | **int** | Priority for eviction when storage quota is reached. Higher values mean the VM is less likely to be evicted. Range is 0-10, default is 5. | [optional] [default to 5]
**type** | **str** |  | 
**delete_event** | [**VmDeleteEvent**](VmDeleteEvent.md) |  | [optional] 

## Example

```python
from freestyle_client.models.vm_persistence import VmPersistence

# TODO update the JSON string below
json = "{}"
# create an instance of VmPersistence from a JSON string
vm_persistence_instance = VmPersistence.from_json(json)
# print the JSON string representation of the object
print(VmPersistence.to_json())

# convert the object into a dict
vm_persistence_dict = vm_persistence_instance.to_dict()
# create an instance of VmPersistence from a dict
vm_persistence_from_dict = VmPersistence.from_dict(vm_persistence_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


