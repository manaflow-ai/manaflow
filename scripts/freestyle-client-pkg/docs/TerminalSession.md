# TerminalSession


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** |  | 
**status** | **str** |  | 
**created** | **str** |  | [optional] 

## Example

```python
from freestyle_client.models.terminal_session import TerminalSession

# TODO update the JSON string below
json = "{}"
# create an instance of TerminalSession from a JSON string
terminal_session_instance = TerminalSession.from_json(json)
# print the JSON string representation of the object
print(TerminalSession.to_json())

# convert the object into a dict
terminal_session_dict = terminal_session_instance.to_dict()
# create an instance of TerminalSession from a dict
terminal_session_from_dict = TerminalSession.from_dict(terminal_session_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


