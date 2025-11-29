# AdditionalRepository


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**repository_id** | **str** |  | 
**path** | **str** |  | 

## Example

```python
from freestyle_client.models.additional_repository import AdditionalRepository

# TODO update the JSON string below
json = "{}"
# create an instance of AdditionalRepository from a JSON string
additional_repository_instance = AdditionalRepository.from_json(json)
# print the JSON string representation of the object
print(AdditionalRepository.to_json())

# convert the object into a dict
additional_repository_dict = additional_repository_instance.to_dict()
# create an instance of AdditionalRepository from a dict
additional_repository_from_dict = AdditionalRepository.from_dict(additional_repository_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


