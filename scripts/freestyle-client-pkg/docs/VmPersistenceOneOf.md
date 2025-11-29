# VmPersistenceOneOf

When your storage quota is reached, the least recently used VMs will be deleted.

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**priority** | **int** | Priority for eviction when storage quota is reached. Higher values mean the VM is less likely to be evicted. Range is 0-10, default is 5. | [optional] [default to 5]
**type** | **str** |  | 

## Example

```python
from freestyle_client.models.vm_persistence_one_of import VmPersistenceOneOf

# TODO update the JSON string below
json = "{}"
# create an instance of VmPersistenceOneOf from a JSON string
vm_persistence_one_of_instance = VmPersistenceOneOf.from_json(json)
# print the JSON string representation of the object
print(VmPersistenceOneOf.to_json())

# convert the object into a dict
vm_persistence_one_of_dict = vm_persistence_one_of_instance.to_dict()
# create an instance of VmPersistenceOneOf from a dict
vm_persistence_one_of_from_dict = VmPersistenceOneOf.from_dict(vm_persistence_one_of_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


