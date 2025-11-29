# ListVmsResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**vms** | [**List[VmInfo]**](VmInfo.md) |  | 
**total_count** | **int** |  | 
**running_count** | **int** |  | 
**starting_count** | **int** |  | 
**stopped_count** | **int** |  | 
**user_id** | **str** |  | [optional] 

## Example

```python
from freestyle_client.models.list_vms_response import ListVmsResponse

# TODO update the JSON string below
json = "{}"
# create an instance of ListVmsResponse from a JSON string
list_vms_response_instance = ListVmsResponse.from_json(json)
# print the JSON string representation of the object
print(ListVmsResponse.to_json())

# convert the object into a dict
list_vms_response_dict = list_vms_response_instance.to_dict()
# create an instance of ListVmsResponse from a dict
list_vms_response_from_dict = ListVmsResponse.from_dict(list_vms_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


