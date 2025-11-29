# ExecRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**dev_server** | [**DevServerIdentifier**](DevServerIdentifier.md) |  | 
**command** | **str** |  | 
**background** | **bool** | Spawn this command as a background process and return immediately | 

## Example

```python
from freestyle_client.models.exec_request import ExecRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ExecRequest from a JSON string
exec_request_instance = ExecRequest.from_json(json)
# print the JSON string representation of the object
print(ExecRequest.to_json())

# convert the object into a dict
exec_request_dict = exec_request_instance.to_dict()
# create an instance of ExecRequest from a dict
exec_request_from_dict = ExecRequest.from_dict(exec_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


