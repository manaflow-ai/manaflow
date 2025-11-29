# CustomBuildOptions


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**command** | **str** |  | 
**out_dir** | **str** |  | [optional] 
**env_vars** | **Dict[str, str]** |  | [optional] 

## Example

```python
from freestyle_client.models.custom_build_options import CustomBuildOptions

# TODO update the JSON string below
json = "{}"
# create an instance of CustomBuildOptions from a JSON string
custom_build_options_instance = CustomBuildOptions.from_json(json)
# print the JSON string representation of the object
print(CustomBuildOptions.to_json())

# convert the object into a dict
custom_build_options_dict = custom_build_options_instance.to_dict()
# create an instance of CustomBuildOptions from a dict
custom_build_options_from_dict = CustomBuildOptions.from_dict(custom_build_options_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


