# LinuxGroupSpec


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** | Unique group name | 
**gid** | **int** | Optional fixed GID; if None, allocate | [optional] 
**system** | **bool** | System group (allocator uses system range) | [optional] [default to False]

## Example

```python
from freestyle_client.models.linux_group_spec import LinuxGroupSpec

# TODO update the JSON string below
json = "{}"
# create an instance of LinuxGroupSpec from a JSON string
linux_group_spec_instance = LinuxGroupSpec.from_json(json)
# print the JSON string representation of the object
print(LinuxGroupSpec.to_json())

# convert the object into a dict
linux_group_spec_dict = linux_group_spec_instance.to_dict()
# create an instance of LinuxGroupSpec from a dict
linux_group_spec_from_dict = LinuxGroupSpec.from_dict(linux_group_spec_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


