# FreestyleGetLogsResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**logs** | [**List[FreestyleLogResponseObject]**](FreestyleLogResponseObject.md) |  | 

## Example

```python
from freestyle_client.models.freestyle_get_logs_response import FreestyleGetLogsResponse

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleGetLogsResponse from a JSON string
freestyle_get_logs_response_instance = FreestyleGetLogsResponse.from_json(json)
# print the JSON string representation of the object
print(FreestyleGetLogsResponse.to_json())

# convert the object into a dict
freestyle_get_logs_response_dict = freestyle_get_logs_response_instance.to_dict()
# create an instance of FreestyleGetLogsResponse from a dict
freestyle_get_logs_response_from_dict = FreestyleGetLogsResponse.from_dict(freestyle_get_logs_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


