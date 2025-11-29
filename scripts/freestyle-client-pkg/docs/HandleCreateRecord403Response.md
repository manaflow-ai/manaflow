# HandleCreateRecord403Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**error** | **str** | Error code in SCREAMING_SNAKE_CASE | 
**message** | **str** | Human-readable error message | 

## Example

```python
from freestyle_client.models.handle_create_record403_response import HandleCreateRecord403Response

# TODO update the JSON string below
json = "{}"
# create an instance of HandleCreateRecord403Response from a JSON string
handle_create_record403_response_instance = HandleCreateRecord403Response.from_json(json)
# print the JSON string representation of the object
print(HandleCreateRecord403Response.to_json())

# convert the object into a dict
handle_create_record403_response_dict = handle_create_record403_response_instance.to_dict()
# create an instance of HandleCreateRecord403Response from a dict
handle_create_record403_response_from_dict = HandleCreateRecord403Response.from_dict(handle_create_record403_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


