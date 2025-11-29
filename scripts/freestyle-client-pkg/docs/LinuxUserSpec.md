# LinuxUserSpec


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** | Unique username | 
**uid** | **int** | Optional fixed UID; if None, allocate | [optional] 
**gecos** | **str** | GECOS field (descriptive string, e.g., full name) | [optional] 
**groups** | **List[str]** | Groups to add user to (all groups use &#39;m&#39; membership lines) | [optional] 
**home** | **str** | Home directory path (optional, defaults to /home/{username} for regular users, / for system users) | [optional] 
**shell** | **str** | Login shell (optional, defaults to /bin/bash for regular users, /usr/sbin/nologin for system users) | [optional] 
**system** | **bool** | System user (allocator uses system range) | [optional] [default to False]

## Example

```python
from freestyle_client.models.linux_user_spec import LinuxUserSpec

# TODO update the JSON string below
json = "{}"
# create an instance of LinuxUserSpec from a JSON string
linux_user_spec_instance = LinuxUserSpec.from_json(json)
# print the JSON string representation of the object
print(LinuxUserSpec.to_json())

# convert the object into a dict
linux_user_spec_dict = linux_user_spec_instance.to_dict()
# create an instance of LinuxUserSpec from a dict
linux_user_spec_from_dict = LinuxUserSpec.from_dict(linux_user_spec_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


