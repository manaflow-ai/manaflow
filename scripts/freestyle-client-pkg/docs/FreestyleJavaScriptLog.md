# FreestyleJavaScriptLog


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**message** | **str** | The log message | 
**type** | **str** | The log level | 

## Example

```python
from freestyle_client.models.freestyle_java_script_log import FreestyleJavaScriptLog

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleJavaScriptLog from a JSON string
freestyle_java_script_log_instance = FreestyleJavaScriptLog.from_json(json)
# print the JSON string representation of the object
print(FreestyleJavaScriptLog.to_json())

# convert the object into a dict
freestyle_java_script_log_dict = freestyle_java_script_log_instance.to_dict()
# create an instance of FreestyleJavaScriptLog from a dict
freestyle_java_script_log_from_dict = FreestyleJavaScriptLog.from_dict(freestyle_java_script_log_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


