# Git1

`dir` is the Directory to deploy from. If not provided, the root of the repository will be used.

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**url** | **str** |  | 
**branch** | **str** |  | [optional] 
**dir** | **str** |  | [optional] 
**kind** | **str** |  | 

## Example

```python
from freestyle_client.models.git1 import Git1

# TODO update the JSON string below
json = "{}"
# create an instance of Git1 from a JSON string
git1_instance = Git1.from_json(json)
# print the JSON string representation of the object
print(Git1.to_json())

# convert the object into a dict
git1_dict = git1_instance.to_dict()
# create an instance of Git1 from a dict
git1_from_dict = Git1.from_dict(git1_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


