# ExecAwaitRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**command** | **str** |  | 
**terminal** | **str** |  | [optional] 
**timeout_ms** | **int** |  | [optional] 

## Example

```python
from freestyle_client.models.exec_await_request import ExecAwaitRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ExecAwaitRequest from a JSON string
exec_await_request_instance = ExecAwaitRequest.from_json(json)
# print the JSON string representation of the object
print(ExecAwaitRequest.to_json())

# convert the object into a dict
exec_await_request_dict = exec_await_request_instance.to_dict()
# create an instance of ExecAwaitRequest from a dict
exec_await_request_from_dict = ExecAwaitRequest.from_dict(exec_await_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


