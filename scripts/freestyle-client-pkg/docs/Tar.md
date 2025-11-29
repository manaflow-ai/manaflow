# Tar


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**url** | **str** |  | 
**dir** | **str** |  | [optional] 
**commit_message** | **str** |  | 
**author_name** | **str** |  | [optional] 
**author_email** | **str** |  | [optional] 
**type** | **str** |  | 

## Example

```python
from freestyle_client.models.tar import Tar

# TODO update the JSON string below
json = "{}"
# create an instance of Tar from a JSON string
tar_instance = Tar.from_json(json)
# print the JSON string representation of the object
print(Tar.to_json())

# convert the object into a dict
tar_dict = tar_instance.to_dict()
# create an instance of Tar from a dict
tar_from_dict = Tar.from_dict(tar_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


