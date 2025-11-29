# DevServerIdentifier


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**repo_id** | **str** |  | 
**git_ref** | **str** |  | [optional] 

## Example

```python
from freestyle_client.models.dev_server_identifier import DevServerIdentifier

# TODO update the JSON string below
json = "{}"
# create an instance of DevServerIdentifier from a JSON string
dev_server_identifier_instance = DevServerIdentifier.from_json(json)
# print the JSON string representation of the object
print(DevServerIdentifier.to_json())

# convert the object into a dict
dev_server_identifier_dict = dev_server_identifier_instance.to_dict()
# create an instance of DevServerIdentifier from a dict
dev_server_identifier_from_dict = DevServerIdentifier.from_dict(dev_server_identifier_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


