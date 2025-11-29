# TerminalLogsArrayResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**logs** | [**List[LogEntry]**](LogEntry.md) |  | 

## Example

```python
from freestyle_client.models.terminal_logs_array_response import TerminalLogsArrayResponse

# TODO update the JSON string below
json = "{}"
# create an instance of TerminalLogsArrayResponse from a JSON string
terminal_logs_array_response_instance = TerminalLogsArrayResponse.from_json(json)
# print the JSON string representation of the object
print(TerminalLogsArrayResponse.to_json())

# convert the object into a dict
terminal_logs_array_response_dict = terminal_logs_array_response_instance.to_dict()
# create an instance of TerminalLogsArrayResponse from a dict
terminal_logs_array_response_from_dict = TerminalLogsArrayResponse.from_dict(terminal_logs_array_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


