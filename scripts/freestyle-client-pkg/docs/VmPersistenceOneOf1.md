# VmPersistenceOneOf1

The VM will be deleted after the idle timeout. It's not guaranteed that the VM will be deleted immediately.

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**delete_event** | [**VmDeleteEvent**](VmDeleteEvent.md) |  | [optional] 
**type** | **str** |  | 

## Example

```python
from freestyle_client.models.vm_persistence_one_of1 import VmPersistenceOneOf1

# TODO update the JSON string below
json = "{}"
# create an instance of VmPersistenceOneOf1 from a JSON string
vm_persistence_one_of1_instance = VmPersistenceOneOf1.from_json(json)
# print the JSON string representation of the object
print(VmPersistenceOneOf1.to_json())

# convert the object into a dict
vm_persistence_one_of1_dict = vm_persistence_one_of1_instance.to_dict()
# create an instance of VmPersistenceOneOf1 from a dict
vm_persistence_one_of1_from_dict = VmPersistenceOneOf1.from_dict(vm_persistence_one_of1_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


