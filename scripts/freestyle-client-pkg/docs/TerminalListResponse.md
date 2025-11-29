# TerminalListResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**terminals** | [**List[TerminalSession]**](TerminalSession.md) |  | 

## Example

```python
from freestyle_client.models.terminal_list_response import TerminalListResponse

# TODO update the JSON string below
json = "{}"
# create an instance of TerminalListResponse from a JSON string
terminal_list_response_instance = TerminalListResponse.from_json(json)
# print the JSON string representation of the object
print(TerminalListResponse.to_json())

# convert the object into a dict
terminal_list_response_dict = terminal_list_response_instance.to_dict()
# create an instance of TerminalListResponse from a dict
terminal_list_response_from_dict = TerminalListResponse.from_dict(terminal_list_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


